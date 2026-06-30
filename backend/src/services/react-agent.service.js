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

const { request, requestStream } = require('../utils/httpClient');

// 工具结果截断常量（防止上下文窗口溢出）
const MAX_TOOL_RESULT_LENGTH = 3000;
const HISTORY_WINDOW = 20;

class ReactAgent {
  constructor(aiService, toolRegistry) {
    this.aiService = aiService;
    this.toolRegistry = toolRegistry;
    this.maxIterations = 10;
    this.conversationIdCounter = 0;
  }

  /**
   * 截断工具结果，保留关键信息但防止 context window 溢出
   *
   * 智能截断策略（而非硬切前 N 字符）：
   *   - 保留开头（表头/统计/标题，通常含最关键的总览信息）
   *   - 保留结尾（末尾的结论/提示/待办，常是 LLM 决策所需的收尾信息）
   *   - 中间内容按"段落"折叠，保留每段首行 + 计数，避免成绩列表等长文本
   *     中间的关键课程数据被整段丢弃
   */
  _truncateResult(content, maxLen = MAX_TOOL_RESULT_LENGTH) {
    if (!content || typeof content !== 'string') return content;
    if (content.length <= maxLen) return content;

    // 保留头尾各约 1/3 预算
    const headBudget = Math.floor(maxLen * 0.35);
    const tailBudget = Math.floor(maxLen * 0.35);
    const head = content.substring(0, headBudget);
    const tail = content.substring(content.length - tailBudget);

    // 中间部分：按行折叠，保留每个非空块的首行，统计被折叠的行数
    const middle = content.substring(headBudget, content.length - tailBudget);
    const lines = middle.split('\n');
    const kept = [];
    let folded = 0;
    let inBlock = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (inBlock) { kept.push(''); inBlock = false; }
        continue;
      }
      // 保留每个"块"的第一行（通常是课程名/分类标题）
      if (!inBlock) {
        kept.push(`  … ${trimmed.substring(0, 60)}`);
        inBlock = true;
      } else {
        folded++;
      }
    }

    const foldedNote = folded > 0
      ? `\n…（中间折叠 ${folded} 行明细，完整数据已保存在工作记忆中）…\n`
      : '\n…（部分明细已折叠，完整数据已保存在工作记忆中）…\n';

    return head + '\n' + foldedNote + kept.join('\n') + '\n…\n' + tail
      + `\n\n...（结果过长，已从 ${content.length} 字符智能截断至约 ${maxLen} 字符）`;
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
   * @param {Object} context - 上下文 { userId, memoryContext, skillPrompt, signal }
   */
  async *execute(message, history = [], context = {}) {
    const { userId, memoryContext, skillPrompt, workingMemory, conversationId, signal, tracer } = context;
    const startTime = Date.now();
    const TOTAL_TIMEOUT = 120000; // 整个 ReAct 循环最多 2 分钟

    // 快速检查是否已断开
    const checkAborted = () => {
      if (signal && signal.aborted) {
        console.log('[ReactAgent] 客户端已断开，终止 ReAct 循环');
        return true;
      }
      return false;
    };

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
    //    多步 ReAct 每轮都拼 system，用精简版 wmContext（仅步骤指针 + 最新 note），
    //    完整结果正文已在 messages 历史的 tool 消息中，无需在 system 重复展开。
    const wmContext = wm.buildContextBrief();
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

    // 无进展循环检测：记录上一轮工具调用签名，连续相同则提示 LLM 收尾
    let lastCallSignature = null;
    let repeatCount = 0;
    let forceFinal = false; // 已提示过收尾，下一轮若仍调工具则强制 break

    // 4. ReAct 循环
    try {
      while (iteration < this.maxIterations) {
      iteration++;

      // 客户端断开检查
      if (checkAborted()) {
        wm.writeNote('客户端已断开');
        wm.endTurn();
        return;
      }

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
        // 流式调用 LLM（携带工具描述）— 真流式：文本 token 实时 yield，工具调用按 index 拼接
        let toolCalls = null;       // 流结束时的完整工具调用
        let finalContent = '';      // 流结束时的完整文本（最终答案用）
        let streamHadContent = false;

        for await (const ev of this._callLLMWithToolsStream(messages, tools, signal)) {
          if (ev.type === 'delta') {
            // 文本 token 实时透传给前端（最终答案的首 token 即出）
            if (ev.content) {
              streamHadContent = true;
              yield { type: 'content', content: ev.content };
            }
          } else if (ev.type === 'end') {
            toolCalls = ev.tool_calls;
            finalContent = ev.content;
          }
        }

        // LLM 返回后检查断开信号
        if (checkAborted()) {
          wm.endTurn();
          return;
        }

        // 检查是否有工具调用
        if (toolCalls && toolCalls.length > 0) {
          hasUsedTool = true;

          // Step 1: 解析所有工具调用
          const parsedCalls = toolCalls.map(tc => {
            const fn = tc.function || {};
            const name = fn.name || '';
            let args = {};
            try {
              args = fn.arguments ? JSON.parse(fn.arguments) : {};
            } catch (e) {
              console.warn(`[ReactAgent] 工具参数解析失败: ${fn.arguments}`);
              args = {};
            }
            return { tc, name, args, id: tc.id || this._genId() };
          });

          // Step 2: 分离 _write_note（元工具）与普通工具
          const notes = parsedCalls.filter(c => c.name === '_write_note');
          const tools_calls = parsedCalls.filter(c => c.name !== '_write_note');

          // Step 3: _write_note 轻量元工具同步执行
          for (const c of notes) {
            yield { type: 'tool_call', tool_call: { id: c.id, name: c.name, arguments: c.tc.function?.arguments || '{}' } };
            const noteContent = c.args.content || c.args.note || JSON.stringify(c.args);
            wm.writeNote(noteContent, c.args.label || '');
            yield { type: 'tool_result', tool_result: { id: c.id, name: c.name, content: '笔记已保存', status: 'done' } };
            messages.push({
              role: 'assistant', content: null,
              tool_calls: [this._formatToolCall(c.tc)],
            });
            messages.push({
              role: 'tool', tool_call_id: c.id,
              content: '笔记已保存（工作记忆）',
            });
          }

          // Step 4: 先 yield 所有普通工具的 tool_call 事件（前端可立即展示）
          for (const c of tools_calls) {
            yield { type: 'tool_call', tool_call: { id: c.id, name: c.name, arguments: c.tc.function?.arguments || '{}' } };
            console.log(`[ReactAgent] 发起工具: ${c.name}, 参数: ${JSON.stringify(c.args)}`);
          }

          // 工具执行前检查断开（前端展示 tool_call 后用户可能关闭页面）
          if (checkAborted()) {
            wm.endTurn();
            return;
          }

          // Step 5: 并行执行所有普通工具
          const startExec = Date.now();
          const settledResults = await Promise.allSettled(
            tools_calls.map(c => this.toolRegistry.executeTool(c.name, c.args, { userId }))
          );
          const execElapsed = Date.now() - startExec;
          console.log(`[ReactAgent] ${tools_calls.length} 个工具并行执行完毕，耗时 ${execElapsed}ms`);

          // Step 6: 统一处理各工具结果
          for (let i = 0; i < tools_calls.length; i++) {
            const c = tools_calls[i];
            const settled = settledResults[i];
            let result = '';
            if (settled.status === 'fulfilled') {
              result = settled.value;
              console.log(`[ReactAgent] 工具 ${c.name} 结果: ${String(result).substring(0, 200)}`);
            } else {
              const errMsg = settled.reason?.message || '未知错误';
              console.error(`[ReactAgent] 工具 ${c.name} 异常:`, errMsg);
              result = `工具执行出错: ${errMsg}`;
            }

            // 记录到工作记忆
            wm.recordStep(c.name, c.args, result);

            // 记录到 Agent 轨迹（便于生产调试）
            if (tracer) {
              tracer.recordToolCall(
                c.name,
                c.args,
                execElapsed,
                settled.status === 'fulfilled',
                settled.status === 'rejected' ? (settled.reason?.message) : undefined
              );
            }

            // 产出 tool_result 事件（前端展示）
            // 附带 durationMs：本轮并行工具的总执行耗时（单工具场景即该工具耗时；
            // 并行多工具共享同一 execElapsed，可接受——并行工具本就该显示相近耗时）
            yield { type: 'tool_result', tool_result: { id: c.id, name: c.name, content: result, status: 'done', durationMs: execElapsed } };

            // 将 assistant 消息（含 tool_calls）加入历史
            messages.push({
              role: 'assistant', content: null,
              tool_calls: [this._formatToolCall(c.tc)],
            });
            // 将工具结果截断后加入历史（tool 角色），避免上下文窗口溢出
            messages.push({
              role: 'tool', tool_call_id: c.id,
              content: this._truncateResult(typeof result === 'string' ? result : JSON.stringify(result)),
            });
          }

          // ---- 无进展循环检测 ----
          // 计算本轮工具调用签名（tool + 参数），与上一轮比较
          const signature = tools_calls
            .map(c => `${c.name}(${JSON.stringify(c.args)})`)
            .sort()
            .join('|');
          if (signature === lastCallSignature) {
            repeatCount++;
          } else {
            repeatCount = 1;
            lastCallSignature = signature;
          }
          // 连续 2 次完全相同的工具调用 → LLM 陷入死循环，强制收尾
          if (repeatCount >= 2) {
            if (!forceFinal) {
              console.warn(`[ReactAgent] 检测到无进展循环（${signature}），提示 LLM 直接给出结论`);
              wm.writeNote('检测到重复工具调用，强制收尾', '中间结论');
              messages.push({
                role: 'user',
                content: '你已经多次调用相同的工具获取到相同结果。请基于已有信息直接给出最终回答，不要再调用任何工具。',
              });
              forceFinal = true;
            } else {
              // 已提示过收尾但仍调工具 → 彻底中断，输出已有信息
              console.warn('[ReactAgent] 提示收尾后仍调用工具，强制中断');
              wm.writeNote('强制中断：提示收尾后仍调用工具', '待验证');
              yield* this._streamContent('已根据获取到的信息整理如下，如需更精确的结果请补充说明：');
              break;
            }
          }
        } else {
          // LLM 直接回复文本 → 最终答案
          // 注意：文本 token 已在流式 delta 阶段实时 yield 给前端，这里只收尾
          const content = finalContent || '';
          wm.writeNote((content || '空响应').substring(0, 500), '最终回答');

          // 若流式阶段没产出任何 content（LLM 返回空），给兜底文案
          if (!streamHadContent) {
            yield { type: 'content', content: content || '抱歉，我没有理解您的问题。', done: false };
          }
          // 发送结束标记（前端依赖 done:true 收尾）
          yield { type: 'content', content: '', done: true };

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
    } finally {
      // 无论正常结束 / 超时 / 异常 / abort，都回填本次 ReAct 的迭代步数到轨迹
      if (tracer) tracer.setIterations(iteration);
    }
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
      max_tokens: this.aiService.maxTokens || 4096,
      temperature: this.aiService.temperature ?? 0.7,
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

  /**
   * 流式 LLM 调用（含工具参数）— 真流式
   *
   * 与 _callLLMWithTools 的区别：
   *   - 用 stream:true 调用，逐 token 解析 SSE
   *   - 文本 delta 实时 yield 给前端（{type:'delta', content}），首 token 即出
   *   - tool_calls delta 按 index 拼接成完整结构，流结束统一 yield（{type:'end', tool_calls, content}）
   *
   * OpenAI 流式 tool_calls 分片格式：
   *   delta.tool_calls = [{index:0, id, function:{name, arguments:"" }}]
   *   delta.tool_calls = [{index:0, function:{arguments:'{"sem'}}]
   *   delta.tool_calls = [{index:0, function:{arguments:'ester":"2025"}}]
   *   → 按 index 累积 id / name / arguments
   *
   * @yields {{type:'delta', content:string} | {type:'end', tool_calls:Array|null, content:string}}
   */
  async *_callLLMWithToolsStream(messages, tools, signal) {
    if (!this.aiService.apiKey) {
      console.warn('[ReactAgent] API Key 缺失，无法使用 ReAct Agent');
      yield { type: 'end', tool_calls: null, content: '' };
      return;
    }

    const path = this.aiService.anthropicMode ? '/v1/messages' : '/v2/chat/completions';
    const payload = {
      model: this.aiService.model,
      messages,
      max_tokens: this.aiService.maxTokens || 4096,
      temperature: this.aiService.temperature ?? 0.7,
      stream: true,
    };
    if (tools && tools.length > 0) payload.tools = tools;

    const body = JSON.stringify(payload);
    const options = this.aiService._buildOptions(path);
    options.headers['Content-Length'] = Buffer.byteLength(body, 'utf8');
    options.timeout = 60000; // 流式调用放宽到 60s（首 token 后持续输出）

    console.log(`[ReactAgent:流式] LLM 调用: model=${this.aiService.model}, messages=${messages.length}, tools=${tools.length}`);

    let res;
    try {
      res = await requestStream(options, body);
    } catch (err) {
      // 连接失败 → 抛出由上层 catch 处理（保持与非流式一致的错误路径）
      const msg = err.message || '未知错误';
      throw new Error(`AI 流式连接失败: ${msg}`);
    }

    if (res.statusCode !== 200) {
      let errBody = '';
      for await (const c of res) errBody += c;
      const code = res.statusCode;
      console.error(`[ReactAgent:流式] ${code}: ${errBody.substring(0, 200)}`);
      if (code === 400) {
        throw new Error('AI 模型不支持工具调用，请检查模型配置。');
      }
      throw new Error(`AI 服务返回错误 ${code}`);
    }

    // 累积器（传给 _applyDelta，便于独立单测）
    const state = {
      contentAccum: '',
      toolCallMap: new Map(),
      hasToolCalls: false,
      anthropic: !!this.aiService.anthropicMode,
    };

    // SSE 解析（行切分 + 委托 _applyDelta 应用 delta）
    let buf = '';
    for await (const chunk of res) {
      // 客户端断开 → 终止流
      if (signal && signal.aborted) {
        res.destroy();
        break;
      }

      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith('event:')) continue;
        if (!t.startsWith('data:')) continue;
        const d = t.slice(5).trim();
        if (d === '[DONE]') continue; // 结束标记，下面统一处理

        try {
          const j = JSON.parse(d);
          const textDelta = this._applyDelta(j, state);
          if (textDelta) {
            yield { type: 'delta', content: textDelta };
          }
        } catch (err) {
          console.warn('[ReactAgent:流式] SSE 解析失败:', err.message);
        }
      }
    }

    // 流结束：组装最终结果
    const { contentAccum, toolCallMap, hasToolCalls } = state;
    let tool_calls = null;
    if (hasToolCalls && toolCallMap.size > 0) {
      tool_calls = Array.from(toolCallMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([_, tc]) => ({
          id: tc.id || this._genId(),
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments || '{}' },
        }));
    }

    yield { type: 'end', tool_calls, content: contentAccum };
  }

  /**
   * 对单个解析后的 SSE 事件应用 delta，更新累积状态
   * 抽成独立方法便于单测（不依赖 HTTP / 流）
   *
   * @param {Object} j - JSON.parse 后的 SSE 事件
   * @param {Object} state - 累积状态 { contentAccum, toolCallMap, hasToolCalls, anthropic }
   * @returns {string|null} 文本 delta（需 yield 给前端），无则 null
   */
  _applyDelta(j, state) {
    if (state.anthropic) {
      // Anthropic 流式：content_block_delta 给文本，tool_use 在 content_block_start/delta
      if (j.type === 'content_block_delta' && j.delta?.text) {
        state.contentAccum += j.delta.text;
        return j.delta.text;
      }
      if (j.type === 'content_block_start' && j.content_block?.type === 'tool_use') {
        state.hasToolCalls = true;
        const idx = j.index ?? 0;
        state.toolCallMap.set(idx, {
          id: j.content_block.id || '',
          name: j.content_block.name || '',
          arguments: '',
        });
      } else if (j.type === 'content_block_delta' && j.delta?.type === 'input_json_delta') {
        const idx = j.index ?? 0;
        const tc = state.toolCallMap.get(idx);
        if (tc) tc.arguments += j.delta.partial_json || '';
      }
      return null;
    }

    // OpenAI 兼容流式
    const choice = j.choices?.[0];
    if (!choice) return null;
    const delta = choice.delta || {};
    let textDelta = null;

    if (delta.content) {
      state.contentAccum += delta.content;
      textDelta = delta.content;
    }

    if (delta.tool_calls) {
      state.hasToolCalls = true;
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        let entry = state.toolCallMap.get(idx);
        if (!entry) {
          entry = { id: tc.id || '', name: tc.function?.name || '', arguments: '' };
          state.toolCallMap.set(idx, entry);
        }
        if (tc.id) entry.id = tc.id;
        if (tc.function?.name) entry.name = tc.function.name;
        if (tc.function?.arguments) entry.arguments += tc.function.arguments;
      }
    }

    return textDelta;
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
      '- 同时调用多个**相互独立**的工具（并行执行，互不依赖对方的输出）',
      '- 根据工具返回的结果，调整策略或调用其他工具',
      '- 使用 _write_note 工具记录中间分析结论到工作记忆',
      '',
      '⚠️ 并行调用规则（重要）：',
      '- 只在多个工具**互不依赖对方输出**时才并行调用（如同时查成绩和查课表）',
      '- 若工具 B 需要 A 的结果作为输入（如先查成绩再算 GPA），**必须分多轮调用**：',
      '  先单独调用 A，拿到结果后再调用 B。一轮里同时返回依赖工具会导致后者取到旧数据。',
      '- 不确定是否有依赖时，默认串行调用（一轮一个工具）。',
      '',
      '工具执行完成后：',
      '- 如果信息足够回答用户问题，直接给出最终答案（不要继续调用工具）',
      '- 如果还需要更多数据，继续调用合适的工具',
      '- 如果工具返回了错误，尝试换个方式或告知用户',
      '',
      '## 工作记忆',
      '你有工作记忆（Working Memory），可以记录和引用之前的工具调用结果。',
      '_write_note 工具可用来记录中间分析结论，这些笔记会在后续步骤中保留。',
      '上方"当前工作记忆"列出本回合已调用的工具与最新笔记；',
      '工具返回的完整结果在对话历史的 tool 消息中，可直接引用（如"上一步查到的成绩..."）。',
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
    const recent = history.slice(-HISTORY_WINDOW);
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
