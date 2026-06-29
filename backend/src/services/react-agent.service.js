"use strict";

const { WorkingMemory } = require('./working-memory.service');

/**
 * ReactAgent — 通用 ReAct 循环执行器
 *
 * 核心思想：LLM 自主规划 → 调用工具 → 观察结果 → 再规划 → ... → 给出最终回答
 *
 * 与传统 Intent→Tool 硬编码映射不同，ReAct Agent：
 * 1. 将所有工具的 JSON Schema 注入 LLM（OpenAI function calling）
 * 2. LLM 自主决定何时调用工具、调用哪个工具、传入什么参数
 * 3. 工具执行结果返回给 LLM，LLM 再决定下一步
 * 4. 直到 LLM 直接给出文本回答（不再调用工具）为止
 *
 * 工作记忆（WorkingMemory）：
 *   所有工具调用结果以结构化 JSON 记录，在后续步骤中 LLM 可通过
 *   _write_note 工具写入中间结论，buildContext() 自动摘要旧记录。
 *
 * 能力：
 * - 动态工具选择（不依赖硬编码的 intent→tool 映射）
 * - 多步推理（"查成绩→分析趋势→推荐课程"可以一次完成）
 * - 错误恢复（工具失败后 LLM 可换策略重试）
 * - 记忆增强（跨步骤工作记忆 + 长短期记忆注入）
 */

const { request } = require('../utils/httpClient');

class ReactAgent {
  constructor(aiService, toolRegistry) {
    this.aiService = aiService;
    this.toolRegistry = toolRegistry;
    this.maxIterations = 10;
    this.conversationIdCounter = 0;
  }

  /**
   * 执行 ReAct 循环，返回异步生成器
   *
   * 产出的事件类型（与 chat.controller.js SSE 格式兼容）：
   *   { type: 'thinking', content: '...' }     → 推理过程
   *   { type: 'tool_call', tool_call: {...} }    → 工具调用
   *   { type: 'tool_result', tool_result: {...} } → 工具结果
   *   { type: 'content', content: '...' }        → 最终回答
   *
   * @param {string} message - 用户消息
   * @param {Array} history - 对话历史 [{role, content}]
   * @param {Object} context - 上下文 { userId, memoryContext, skillPrompt }
   */
  async *execute(message, history = [], context = {}) {
    const { userId, memoryContext, skillPrompt, workingMemory, conversationId } = context;
    const startTime = Date.now();
    const TOTAL_TIMEOUT = 120000; // 整个 ReAct 循环最多 2 分钟

    // 初始化/获取工作记忆
    /** @type {WorkingMemory} */
    const wm = workingMemory || new WorkingMemory({ userId, conversationId });
    wm.startTurn();
    // 记录用户消息
    wm.writeNote(message, '用户问题');

    // 1. 获取可用的工具 schema 并注入工作记忆工具
    const tools = this.toolRegistry.getToolSchemas() || [];
    // 注入 _write_note 元工具（让 LLM 可以写中间笔记到工作记忆）
    tools.push({
      type: 'function',
      function: {
        name: '_write_note',
        description: '将推理过程中的中间结论、分析、或重要发现写入工作记忆，供后续步骤引用。当你需要记录阶段性分析结果时使用。',
        parameters: {
          type: 'object',
          properties: {
            note: {
              type: 'string',
              description: '笔记内容：你的中间分析结论、观察到的重要信息、或下一步计划'
            },
            label: {
              type: 'string',
              description: '笔记标签，如"初步分析"、"中间结论"、"待验证"',
              enum: ['初步分析', '中间结论', '待验证', '最终结论', '观察']
            }
          },
          required: ['note']
        }
      }
    });

    // 2. 构建系统提示词（含工作记忆）
    const wmContext = wm.buildContext();
    const systemPrompt = this._buildSystemPrompt(memoryContext, skillPrompt, wmContext);

    console.log(`[ReactAgent] 系统提示词 ${systemPrompt.length} 字符，${tools.length} 个工具可用`);

    // 3. 初始化消息队列
    const messages = [
      { role: 'system', content: systemPrompt },
      ...this._formatHistory(history),
      { role: 'user', content: message },
    ];

    let iteration = 0;
    let hasUsedTool = false;

    // 4. ReAct 循环
    while (iteration < this.maxIterations) {
      iteration++;

      // 总超时检查
      if (Date.now() - startTime > TOTAL_TIMEOUT) {
        wm.writeNote('处理超时');
        wm.endTurn();
        yield* this._streamContent('处理超时，请简化您的问题或分步提问。');
        return;
      }

      // 产出思考事件
      const thinkingText = iteration === 1
        ? '正在分析您的问题，思考需要哪些信息...'
        : `第 ${iteration} 步推理：结合已有信息，决定下一步操作...`;
      yield { type: 'thinking', content: thinkingText };

      try {
        // 调用 LLM（携带工具描述）
        const response = await this._callLLMWithTools(messages, tools);

        if (!response) {
          wm.writeNote('LLM 无响应', '待验证');
          wm.endTurn();
          yield* this._streamContent('AI 服务暂时无响应，请稍后重试。');
          return;
        }

        // 检查是否有工具调用
        if (response.tool_calls && response.tool_calls.length > 0) {
          hasUsedTool = true;

          for (const tc of response.tool_calls) {
            const fn = tc.function || {};
            const name = fn.name || '';
            let args = {};

            try {
              args = fn.arguments ? JSON.parse(fn.arguments) : {};
            } catch (e) {
              console.warn(`[ReactAgent] 工具参数解析失败: ${fn.arguments}`);
              args = {};
            }

            // 产出 tool_call 事件（前端展示）
            const toolCallId = tc.id || this._genId();
            const toolCallEvent = {
              id: toolCallId,
              name,
              arguments: fn.arguments || '{}',
            };
            yield { type: 'tool_call', tool_call: toolCallEvent };

            // ---- 特殊工具：_write_note（LLM 写工作笔记） ----
            if (name === '_write_note') {
              const noteContent = args.content || args.note || JSON.stringify(args);
              wm.writeNote(noteContent, args.label || '');
              const toolResultEvent = {
                id: toolCallId,
                name,
                content: '笔记已保存',
                status: 'done',
              };
              yield { type: 'tool_result', tool_result: toolResultEvent };

              messages.push({
                role: 'assistant',
                content: null,
                tool_calls: [this._formatToolCall(tc)],
              });
              messages.push({
                role: 'tool',
                tool_call_id: toolCallId,
                content: '笔记已保存（工作记忆）',
              });
              continue; // 不计数为工具调用
            }

            // ---- 正常工具执行 ----
            console.log(`[ReactAgent] 执行工具: ${name}, 参数: ${JSON.stringify(args)}`);
            let result = '';
            try {
              result = await this.toolRegistry.executeTool(name, args, { userId });
              console.log(`[ReactAgent] 工具 ${name} 结果: ${result.substring(0, 200)}`);
            } catch (err) {
              console.error(`[ReactAgent] 工具 ${name} 异常:`, err.message);
              result = `工具执行出错: ${err.message}`;
            }

            // 记录到工作记忆
            wm.recordStep(name, args, result);

            // 产出 tool_result 事件（前端展示）
            const toolResultEvent = {
              id: toolCallId,
              name,
              content: result,
              status: 'done',
            };
            yield { type: 'tool_result', tool_result: toolResultEvent };

            // 将 assistant 消息（含 tool_calls）加入历史
            messages.push({
              role: 'assistant',
              content: null,
              tool_calls: [this._formatToolCall(tc)],
            });

            // 将工具结果加入历史（tool 角色）
            messages.push({
              role: 'tool',
              tool_call_id: toolCallId,
              content: typeof result === 'string' ? result : JSON.stringify(result),
            });
          }
        } else {
          // LLM 直接回复文本 → 这是最终答案，分块流式输出
          const content = response.content || '抱歉，我没有理解您的问题。';
          wm.writeNote(content.substring(0, 500), '最终回答');
          yield* this._streamContent(content);

          wm.endTurn();
          console.log(`[ReactAgent] 完成，共 ${iteration} 步推理，${wm.currentTurn?.steps.length || 0} 步工具调用`);
          return;
        }
      } catch (err) {
        console.error(`[ReactAgent] 第 ${iteration} 步出错:`, err.message);
        if (hasUsedTool) {
          yield* this._streamContent(`分析过程中遇到问题：${err.message}。以上是已获取到的信息。`);
        } else {
          yield* this._streamContent(`处理您的请求时出错：${err.message}，请稍后重试。`);
        }
        wm.endTurn();
        return;
      }
    }

    // 达到最大迭代次数
    wm.writeNote('已达到最大推理步数限制', '待验证');
    wm.endTurn();
    yield* this._streamContent('您的问题涉及较多步骤，无法在当前限制内完成。请尝试将问题拆解后分步提问，或简化您的问题。');
  }

  // ==================== LLM 调用（含工具参数） ====================

  async _callLLMWithTools(messages, tools) {
    if (!this.aiService.apiKey) {
      console.warn('[ReactAgent] API Key 缺失，无法使用 ReAct Agent');
      return null;
    }

    const path = this.aiService.anthropicMode ? '/v1/messages' : '/v2/chat/completions';

    const payload = {
      model: this.aiService.model,
      messages,
      max_tokens: 4096, // ReAct 需要更多 token
      temperature: 0.7,
      stream: false,
    };

    // 注入工具定义（OpenAI function calling 格式）
    if (tools && tools.length > 0) {
      payload.tools = tools;
    }

    const body = JSON.stringify(payload);
    const options = this.aiService._buildOptions(path);
    options.headers['Content-Length'] = Buffer.byteLength(body, 'utf8');
    options.timeout = 30000; // 单次 LLM 调用 30 秒超时

    console.log(`[ReactAgent] LLM 调用: model=${this.aiService.model}, messages=${messages.length}, tools=${tools.length}`);

    try {
      const result = await request(options, body);
      const json = result.data;
      const choice = json?.choices?.[0];

      if (!choice) {
        console.warn('[ReactAgent] LLM 返回空:', JSON.stringify(json).substring(0, 200));
        return null;
      }

      const message = choice.message || {};
      const content = message.content || '';

      // 检查 finish_reason — 'tool_calls' 表示 LLM 想调用工具
      if (choice.finish_reason === 'tool_calls' && message.tool_calls) {
        return {
          content,
          tool_calls: message.tool_calls,
        };
      }

      return {
        content,
        tool_calls: null,
      };
    } catch (err) {
      if (err.statusCode === 400) {
        // 可能是工具定义或消息格式问题
        const detail = err.body ? err.body.substring(0, 200) : '';
        console.error(`[ReactAgent] LLM 400 错误: ${detail}`);
        throw new Error(`AI 模型不支持工具调用，请检查模型配置。${detail ? ' ' + detail : ''}`);
      }
      if (err.statusCode) {
        throw new Error(`AI 服务返回错误 ${err.statusCode}`);
      }
      throw new Error(`AI 请求失败: ${err.message}`);
    }
  }

  // ==================== 系统提示词 ====================

  _buildSystemPrompt(memoryContext, skillPrompt, wmContext) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    });
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    const parts = [
      '你是武汉理工大学的校园 AI 助手（武理小精灵）。',
      '你拥有调用工具的能力，可以获取实时数据来回答用户问题。',
      '',
      '## 行为准则',
      '1. 始终使用中文回答，语气友好、专业。',
      '2. 如果需要查询个人数据（成绩、课表、考试等），优先使用工具获取。',
      '3. 如果用户未绑定学校账号，工具会返回相关提示，请引导用户去设置页面绑定。',
      '4. 当你需要更多信息时，可以使用工具。当信息足够时，直接给出完整回答。',
      '5. 不要编造数据——如果工具没有返回所需信息，诚实地告诉用户。',
      '6. 一次可以调用多个工具（并行），但优先调用最可能提供信息的工具。',
      '7. 分析复杂问题时，逐步展示你的推理过程，让用户理解你的思路。',
      '',
      `## 当前时间\n当前日期：${dateStr}\n当前时间：${timeStr}`,
      '',
      '## 工具使用说明',
      '当需要获取数据时，请使用我提供的工具。每个工具都有明确的用途和参数说明。',
      '你可以：',
      '- 一次调用一个工具，等结果回来后决定下一步',
      '- 同时调用多个相互独立的工具（并行执行）',
      '- 根据工具返回的结果，调整策略或调用其他工具',
      '- 使用 _write_note 工具记录中间分析结论到工作记忆',
      '',
      '工具执行完成后：',
      '- 如果信息足够回答用户问题，直接给出最终答案（不要继续调用工具）',
      '- 如果还需要更多数据，继续调用合适的工具',
      '- 如果工具返回了错误，尝试换个方式或告知用户',
      '',
      '## 工作记忆',
      '你有工作记忆（Working Memory），可以记录和引用之前的工具调用结果。',
      '_write_note 工具可用来记录中间分析结论，这些笔记会在后续步骤中保留。',
      '你可以引用之前步骤的结果，如"上一步查到的成绩数据显示..."。',
      '',
      '## 回答格式',
      '- 好的回答应该结构清晰、信息完整',
      '- 对于数据较多的场景（如成绩列表），使用表格或列表展示',
      '- 给出结论时，附带数据依据',
      '',
    ];

    if (memoryContext) {
      parts.push(`\n## 对话上下文与记忆\n以下是关于这个用户我记住的信息：\n${memoryContext}\n`);
      parts.push('注意：这些记忆来源于历史对话，可能不准确。以用户当前的问题为准。');
    }

    if (wmContext) {
      parts.push(`\n## 当前对话的工作记忆\n${wmContext}\n`);
    }

    if (skillPrompt) {
      parts.push(`\n## 技能规范\n${skillPrompt}\n`);
    }

    return parts.join('\n');
  }

  /**
   * 将最终文本分块流式输出，实现打字机效果
   * 与 agent.service.js 的 _streamContent 行为一致
   */
  async *_streamContent(content) {
    if (!content) return;
    const chunkSize = 60;
    for (let i = 0; i < content.length; i += chunkSize) {
      yield { type: 'content', content: content.substring(i, i + chunkSize) };
    }
  }

  // ==================== 历史格式化 ====================

  _formatHistory(history) {
    if (!history || !Array.isArray(history)) return [];
    // 取最近 30 条消息，避免超出上下文窗口
    const recent = history.slice(-30);
    return recent.map(h => ({
      role: h.role === 'model' ? 'assistant' : h.role,
      content: h.content || '',
    }));
  }

  /**
   * 将 OpenAI 格式的 tool_call 转换为存储格式
   */
  _formatToolCall(tc) {
    return {
      id: tc.id,
      type: 'function',
      function: {
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || '{}',
      },
    };
  }

  _genId() {
    return `tc_${Date.now()}_${++this.conversationIdCounter}_${Math.random().toString(36).substring(2, 6)}`;
  }
}

module.exports = { ReactAgent };
