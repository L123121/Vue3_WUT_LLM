"use strict";

const { AiService } = require("./ai.service");
const { executeTool, getToolSchemas, getToolNames } = require("./agent-tools");
const config = require("../config");

/**
 * AgentService — 轻量 Agent 工具调度层（V2.0，面试官反馈②）
 *
 * 吸取存档回退教训（2026-07-21：ReAct 多步循环延迟高、前端展示思考过程对校园用户是减分项），
 * 不做 ReAct 多步循环，做**单轮工具调度（tool routing）**：
 *
 *   用户问题
 *     ↓
 *   ① LLM 决策（带工具 schema，JSON 输出）→ 决定调 search_knowledge_base / calculate / 直接回答
 *     ↓
 *   ② 确定性执行工具（本地/秒级，含超时闸门）
 *     ↓
 *   ③ 工具结果拼入上下文 → LLM 流式生成最终答案
 *
 * 全程最多 1 轮工具调用，无多步循环，延迟 ≈ RAG 链路 + 1 次决策调用。
 * 多轮上下文：不引入 Redis 工作记忆（回退教训），复用 aiService._compactHistory 滚动压缩。
 *
 * 开关：AGENT_TOOL_ENABLED=true 启用（默认 false，先灰度，不影响现有评测基线）。
 */

// 工具决策 prompt：只让 LLM 决定"调哪个工具、传什么参数"，不做推理
const TOOL_DECISION_PROMPT = `你是工具调度器。根据用户问题，决定是否需要调用工具，只返回 JSON。

可用工具：
{tool_schemas}

规则：
1. 如果问题需要检索校园知识库（食堂/图书馆/宿舍/课程/政策/奖学金/面试题等）→ 调用 search_knowledge_base
2. 如果问题需要数学计算 → 调用 calculate
3. 如果不需要任何工具，直接回答 → tool 为 null
4. 只返回 JSON，不要其他内容
5. 参数必须严格符合工具定义

用户问题：{message}

返回格式：
{
  "tool": "工具名或 null",
  "args": { "参数名": "值" },
  "reason": "简短决策理由"
}`;

// 最终回答 prompt：工具结果注入上下文
const FINAL_ANSWER_PROMPT = `你是"武理小精灵"，武汉理工大学校园助手。请基于以下工具检索结果回答用户问题。
如果检索结果不足以回答，请如实说明。

工具调用：{tool_name}
工具结果：
{tool_result}

请用简洁的中文回答。`;

class AgentService {
  constructor(aiService = null) {
    this.aiService = aiService || new AiService();
    this.toolEnabled = config.agent?.toolEnabled === true;
  }

  get enabled() {
    return this.toolEnabled;
  }

  get toolNames() {
    return getToolNames();
  }

  /**
   * ① LLM 决策：返回 { tool, args, reason }
   */
  async decide(message, history = []) {
    const schemas = getToolSchemas();
    const schemaText = schemas.length
      ? schemas.map(s => JSON.stringify(s.function)).join('\n')
      : '（无可用工具）';
    const prompt = TOOL_DECISION_PROMPT
      .replace('{tool_schemas}', schemaText)
      .replace('{message}', String(message || ''));

    const response = await Promise.race([
      this.aiService.getCompletion(prompt, [], { timeout: 15000, retries: 0 }),
      new Promise((resolve) =>
        setTimeout(() => resolve({ content: '', _timeout: true }), 15000)
      ),
    ]);
    if (response._timeout) {
      console.warn('[Agent] 工具决策超时(15s)，直接回答');
      return { tool: null, args: {}, reason: '决策超时，直接回答' };
    }

    const content = String(response.content || '').trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Agent] 无法从决策响应提取 JSON，直接回答:', content);
      return { tool: null, args: {}, reason: '决策解析失败，直接回答' };
    }

    try {
      const result = JSON.parse(jsonMatch[0]);
      const tool = result.tool && result.tool !== 'null' ? result.tool : null;
      const available = getToolNames();
      if (tool && !available.includes(tool)) {
        console.warn(`[Agent] LLM 请求了不可用工具 ${tool}，直接回答`);
        return { tool: null, args: {}, reason: `工具 ${tool} 不可用` };
      }
      return {
        tool,
        args: result.args || {},
        reason: result.reason || '',
      };
    } catch (err) {
      console.warn('[Agent] 决策 JSON 解析失败，直接回答:', err.message);
      return { tool: null, args: {}, reason: '决策解析失败，直接回答' };
    }
  }

  /**
   * ② 确定性执行工具
   */
  async runTool(tool, args, context = {}) {
    console.log(`[Agent] 执行工具: ${tool}, 参数: ${JSON.stringify(args)}`);
    const result = await executeTool(tool, args, context);
    console.log(`[Agent] 工具 ${tool} 结果: ${String(result).substring(0, 300)}`);
    return result;
  }

  /**
   * ③ 单轮工具调度 → 流式回答
   * @param {string} message
   * @param {Array} history
   * @param {Object} options { userId, traceId, conversationId }
   * @yields {type: 'tool_call'|'tool_result'|'content'}
   */
  async *chatStream(message, history = [], options = {}) {
    const totalStart = Date.now();

    // ① 决策（无工具可调时跳过）
    let decision = { tool: null, args: {}, reason: '无可用工具' };
    if (getToolNames().length > 0) {
      try {
        decision = await this.decide(message, history || []);
      } catch (err) {
        console.warn('[Agent] 决策调用失败，直接回答:', err.message);
      }
    }
    yield { type: 'tool_call', tool_call: { name: decision.tool || 'direct', arguments: decision.args || {}, reason: decision.reason } };

    // ② 执行工具（有工具才执行）
    let toolResult = null;
    if (decision.tool) {
      const execStart = Date.now();
      try {
        toolResult = await this.runTool(decision.tool, decision.args || {}, { userId: options.userId });
      } catch (err) {
        toolResult = `工具执行失败: ${err.message}`;
      }
      const durationMs = Date.now() - execStart;
      yield { type: 'tool_result', tool_result: { name: decision.tool, content: toolResult, status: 'done', durationMs } };
    }

    // ③ 生成最终回答
    let prompt = message;
    if (toolResult != null) {
      prompt = FINAL_ANSWER_PROMPT
        .replace('{tool_name}', decision.tool)
        .replace('{tool_result}', String(toolResult).substring(0, 4000));
    }

    let fullReply = '';
    let outputChars = 0;
    for await (const chunk of this.aiService.getCompletionStream(prompt, history || [])) {
      if (chunk.done) {
        console.log(`[Agent] 完成，决策=${decision.tool}, 输出 ${outputChars} 字符, 总耗时 ${Date.now() - totalStart}ms`);
        yield { type: 'content', content: '', done: true };
        return;
      }
      outputChars += (chunk.content || '').length;
      fullReply += chunk.content || '';
      yield { type: 'content', content: chunk.content, done: false };
    }
  }

  /**
   * 非流式单轮调度（工具/接口复用）
   */
  async chat(message, history = [], options = {}) {
    let decision = { tool: null, args: {}, reason: '无可用工具' };
    if (getToolNames().length > 0) {
      try {
        decision = await this.decide(message, history || []);
      } catch (err) {
        console.warn('[Agent] 决策调用失败，直接回答:', err.message);
      }
    }

    let toolResult = null;
    if (decision.tool) {
      toolResult = await this.runTool(decision.tool, decision.args || {}, { userId: options.userId });
    }

    let prompt = message;
    if (toolResult != null) {
      prompt = FINAL_ANSWER_PROMPT
        .replace('{tool_name}', decision.tool)
        .replace('{tool_result}', String(toolResult).substring(0, 4000));
    }

    const result = await this.aiService.getCompletion(prompt, history || []);
    return {
      reply: result.content,
      isMock: !!result.isMock,
      model: result.model || config.ai.model || 'step-3.7-flash',
      sources: [],
      tool: { name: decision.tool, args: decision.args || {}, reason: decision.reason, result: toolResult },
    };
  }
}

module.exports = { AgentService, TOOL_DECISION_PROMPT, FINAL_ANSWER_PROMPT };
