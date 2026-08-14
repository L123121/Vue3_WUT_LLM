"use strict";

const { AiService } = require("./ai.service");
const { executeTool, getToolSchemas, getToolNames } = require("./agent-tools");
const config = require("../config");

/**
 * AgentService — 轻量 Agent 工具调度层（V2.0，面试官反馈②）
 *
 * 吸取存档回退教训（2026-07-21：ReAct 多步循环延迟高、前端展示思考过程对校园用户是减分项），
 * 不做 ReAct 多步循环，做**单轮工具调度（tool routing）+ 原生 function calling**：
 *
 *   用户问题
 *     ↓
 *   ① LLM 原生工具调用（opts.tools 携带 schema，流式解析 delta.tool_calls）
 *     → 决定调 search_knowledge_base / calculate / 直接回答
 *     ↓
 *   ② 确定性执行工具（本地/秒级，含超时闸门）
 *     ↓
 *   ③ 工具结果以 tool 角色消息回注（assistant tool_calls + tool result）
 *     → LLM 二次流式生成最终答案
 *
 * 全程最多 1 轮工具调用 + 1 次回注生成，无多步循环。
 * 延迟 ≈ RAG 链路 + 2 次 LLM 调用（决策 + 回注生成）。
 * 多轮上下文：复用 aiService._compactHistory 滚动压缩。
 *
 * 开关：AGENT_TOOL_ENABLED=true 启用（默认 false，先灰度，不影响现有评测基线）。
 */

// 系统提示：说明工具用法，要求基于工具结果回答（首次调用带 tools，回注后不带 tools 复用）
const SYSTEM_PROMPT = `你是"武理小精灵"，武汉理工大学校园助手。

你可以调用以下工具来获取信息：
{tool_schemas}

规则：
1. 如果问题需要检索校园知识库（食堂/图书馆/宿舍/课程/政策/奖学金/面试题等）→ 调用 search_knowledge_base
2. 如果问题需要数学计算 → 调用 calculate
3. 如果不需要任何工具，直接回答即可
4. 调用工具后，必须基于工具结果给出最终回答；如果工具结果不足以回答，请如实说明
5. 回答用简洁的中文`;

/**
 * 会话级结构化记忆提取（L3，无 Redis）
 *
 * 从 history 中提取跨轮上下文，注入 system prompt，解决多轮指代断裂
 * （如"上一轮说的高数，这轮问'那道题'"）。不引入工作记忆存储，
 * 只做"最近几轮的结构化摘要"，随每次请求重新计算——零持久化成本。
 *
 * @param {Array} history - 对话历史 [{role, content}]
 * @returns {string|null} 记忆摘要文本，无历史时返回 null
 */
function buildMemorySummary(history = []) {
  if (!Array.isArray(history) || history.length === 0) return null;

  // 只看最近 6 条（历史本身已有 _compactHistory 压缩，这里只做摘要）
  const recent = history.slice(-6);
  const lastUser = [...recent].reverse().find((h) => h.role === "user");
  const lastAssistant = [...recent].reverse().find((h) => h.role === "assistant");

  const parts = [];
  // 最近提问主题（取前 60 字）
  if (lastUser?.content) {
    const topic = String(lastUser.content).replace(/\s+/g, " ").trim().slice(0, 60);
    if (topic) parts.push(`最近提问：${topic}`);
  }
  // 上一轮回答结论（取前 120 字）
  if (lastAssistant?.content) {
    const conclusion = String(lastAssistant.content).replace(/\s+/g, " ").trim().slice(0, 120);
    if (conclusion) parts.push(`上一轮回答结论：${conclusion}`);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

/**
 * 组装首次调用的 messages：system（含会话记忆）+ history + 当前问题
 */
function buildDecisionMessages(message, history = []) {
  const schemas = getToolSchemas();
  const schemaText = schemas.length
    ? schemas.map((s) => JSON.stringify(s.function)).join("\n")
    : "（无可用工具）";

  let system = SYSTEM_PROMPT.replace("{tool_schemas}", schemaText);
  // L3 会话记忆：跨轮指代（"那道题"）依赖它
  const memory = buildMemorySummary(history);
  if (memory) {
    system += `\n\n以下是此前对话的摘要（用于理解指代，不是新问题）：\n${memory}`;
  }

  const hist = Array.isArray(history) ? history : [];
  const messages = [{ role: "system", content: system }];
  for (const h of hist) {
    const role = h.role === "assistant" ? "assistant" : "user";
    const content = String(h.content || "").slice(0, 2000);
    if (content) messages.push({ role, content });
  }
  messages.push({ role: "user", content: String(message || "") });
  return messages;
}

/**
 * 解析工具调用参数（arguments 为 JSON 字符串）
 */
function parseToolArgs(rawArgs) {
  if (!rawArgs || rawArgs === "{}") return {};
  try {
    const parsed = JSON.parse(rawArgs);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    console.warn("[Agent] tool_call arguments 解析失败，降级为空参数:", err.message);
    return {};
  }
}

/**
 * 把原生 tool_calls 转为 assistant 消息格式（用于回注）
 */
function toAssistantToolCalls(toolCalls) {
  return (toolCalls || []).map((tc) => ({
    id: tc.id,
    type: tc.type || "function",
    function: {
      name: tc.function?.name || "",
      arguments: tc.function?.arguments || "{}",
    },
  }));
}

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
   * ① 原生 function calling 决策：返回 { toolCalls, content }
   * 优先走 getCompletion（非流式，一次拿全 tool_calls）；无 Key 时返回空
   */
  async decide(message, history = []) {
    const tools = getToolSchemas();
    const messages = buildDecisionMessages(message, history);

    const response = await Promise.race([
      this.aiService.getCompletion(message, [], { tools, messages, timeout: 15000, retries: 0 }),
      new Promise((resolve) =>
        setTimeout(() => resolve({ content: "", toolCalls: null, _timeout: true }), 15000)
      ),
    ]);
    if (response._timeout) {
      console.warn("[Agent] 工具决策超时(15s)，直接回答");
      return { toolCalls: null, content: "", reason: "决策超时，直接回答" };
    }
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return { toolCalls: null, content: response.content || "", reason: "LLM 直接回答" };
    }
    return { toolCalls: response.toolCalls, content: response.content || "", reason: "原生 function calling" };
  }

  /**
   * ② 确定性执行工具
   */
  async runTool(name, args, context = {}) {
    console.log(`[Agent] 执行工具: ${name}, 参数: ${JSON.stringify(args)}`);
    const result = await executeTool(name, args, context);
    console.log(`[Agent] 工具 ${name} 结果: ${String(result).substring(0, 300)}`);
    return result;
  }

  /**
   * ③ 多轮工具调度 → 流式回答（原生 function calling，L2）
   *
   * 最多 maxToolRounds 轮（AGENT_MAX_TOOL_ROUNDS，默认 2）：
   *   - 每轮：LLM 原生工具调用 → 若调工具则执行并回注 tool 结果，继续下一轮
   *   - LLM 直接回答（无 tool_calls）→ 立即收尾
   *   - 无进展检测：连续 2 轮相同工具调用签名 → 强制收尾（防死循环）
   *   - 达到轮次上限 → 最后不带 tools 生成最终答案（强制收尾）
   *
   * @param {string} message
   * @param {Array} history
   * @param {Object} options { userId, traceId, conversationId }
   * @yields {type: 'tool_call'|'tool_result'|'content'}
   */
  async *chatStream(message, history = [], options = {}) {
    const totalStart = Date.now();
    const tools = getToolSchemas();
    const maxRounds = config.agent?.maxToolRounds || 2;
    let messages = buildDecisionMessages(message, history);

    // agent tracer（可观测性，L4）：记录轮次/工具调用/耗时/收尾原因，结束时随 SSE 下发
    const trace = {
      traceId: options.traceId || `agent_${Date.now().toString(36)}`,
      userId: options.userId || null,
      conversationId: options.conversationId || null,
      message,
      rounds: 0,
      toolCalls: [],
      totalMs: 0,
      finishReason: "direct_answer", // direct_answer | round_limit | no_progress | error
    };

    let lastSignature = null;
    let repeatCount = 0;
    let toolSummary = [];
    let reachedLimit = false;

    for (let round = 0; round < maxRounds; round++) {
      trace.rounds = round + 1;
      let toolCalls = null;
      let streamedText = "";
      try {
        for await (const chunk of this.aiService.getCompletionStream("", [], { tools, messages })) {
          if (chunk.done) {
            toolCalls = chunk.tool_calls || null;
          } else if (chunk.content) {
            // LLM 直接开始回答（未调工具）→ 实时透传
            streamedText += chunk.content;
            yield { type: "content", content: chunk.content, done: false };
          }
        }
      } catch (err) {
        console.warn(`[Agent] 第 ${round + 1} 轮决策失败，直接回答:`, err.message);
        trace.finishReason = "error";
        trace.totalMs = Date.now() - totalStart;
        if (!streamedText) {
          yield { type: "content", content: "抱歉，我没有理解您的问题。", done: false };
        }
        yield { type: "trace", trace };
        yield { type: "content", content: "", done: true };
        return;
      }

      const validCalls = (toolCalls || []).filter((tc) => tc.function?.name);

      // LLM 直接回答（无工具调用）→ 收尾
      if (validCalls.length === 0) {
        if (!streamedText) {
          yield { type: "content", content: "抱歉，我没有理解您的问题。", done: false };
        }
        trace.totalMs = Date.now() - totalStart;
        yield { type: "trace", trace };
        yield { type: "content", content: "", done: true };
        console.log(`[Agent] 完成（直接回答，第 ${round + 1} 轮），总耗时 ${Date.now() - totalStart}ms`);
        return;
      }

      // 下发 tool_call 事件（前端展示）
      for (const tc of validCalls) {
        yield { type: "tool_call", tool_call: { name: tc.function.name, arguments: parseToolArgs(tc.function.arguments) } };
      }

      // 执行工具（含超时闸门）
      const execStart = Date.now();
      const results = [];
      for (const tc of validCalls) {
        let result;
        let ok = true;
        try {
          result = await this.runTool(tc.function.name, parseToolArgs(tc.function.arguments), { userId: options.userId });
          if (/^(工具.*失败|工具.*超时|未知工具)/.test(String(result))) ok = false;
        } catch (err) {
          result = `工具执行失败: ${err.message}`;
          ok = false;
        }
        results.push({ tc, result });
        trace.toolCalls.push({
          name: tc.function.name,
          args: parseToolArgs(tc.function.arguments),
          ok,
          durationMs: Date.now() - execStart,
        });
      }
      const durationMs = Date.now() - execStart;

      // 下发 tool_result 事件（前端展示）
      for (const { tc, result } of results) {
        yield { type: "tool_result", tool_result: { name: tc.function.name, content: result, status: "done", durationMs } };
      }
      toolSummary.push(validCalls.map((t) => t.function.name).join(","));

      // 工具结果回注（tool 角色消息，供下一轮决策/最终生成）
      messages = [
        ...messages,
        { role: "assistant", content: null, tool_calls: toAssistantToolCalls(validCalls) },
        ...results.map(({ tc, result }) => ({
          role: "tool",
          tool_call_id: tc.id,
          content: String(result).substring(0, 4000),
        })),
      ];

      // ---- 无进展检测：连续 2 轮相同工具调用 → 强制收尾 ----
      const signature = validCalls.map((t) => `${t.function.name}:${t.function.arguments}`).join("|");
      if (signature === lastSignature) {
        repeatCount++;
        if (repeatCount >= 2) {
          console.warn(`[Agent] 检测到无进展循环（${signature}），强制收尾`);
          trace.finishReason = "no_progress";
          messages = [
            ...messages,
            { role: "user", content: "你已多次调用相同工具。请基于已有信息直接给出最终回答，不要再调用任何工具。" },
          ];
          reachedLimit = true;
          break;
        }
      } else {
        lastSignature = signature;
        repeatCount = 1;
      }

      // 达到最大轮次 → 强制收尾（最后生成不带 tools，杜绝继续调工具）
      if (round >= maxRounds - 1) {
        trace.finishReason = "round_limit";
        reachedLimit = true;
      }
    }

    // 收尾生成：不带 tools，强制 LLM 基于已回注的工具结果给出最终答案
    const finalTools = reachedLimit ? [] : tools;
    for await (const chunk of this.aiService.getCompletionStream("", [], { messages, tools: finalTools })) {
      if (chunk.done) {
        trace.totalMs = Date.now() - totalStart;
        console.log(`[Agent] 完成，工具=${toolSummary.join(";")}, 总耗时 ${trace.totalMs}ms`);
        yield { type: "trace", trace };
        yield { type: "content", content: "", done: true };
        return;
      }
      if (chunk.content) {
        yield { type: "content", content: chunk.content, done: false };
      }
    }
  }

  /**
   * 非流式多轮调度（原生 function calling，L2）
   * 逻辑与 chatStream 一致：最多 maxToolRounds 轮，无进展检测 + 强制收尾
   */
  async chat(message, history = [], options = {}) {
    const tools = getToolSchemas();
    const maxRounds = config.agent?.maxToolRounds || 2;
    let messages = buildDecisionMessages(message, history || []);

    let lastSignature = null;
    let repeatCount = 0;
    let toolSummary = [];

    for (let round = 0; round < maxRounds; round++) {
      let response;
      try {
        response = await this.aiService.getCompletion("", [], { tools, messages, timeout: 15000, retries: 0 });
      } catch (err) {
        console.warn(`[Agent] 第 ${round + 1} 轮决策失败，直接回答:`, err.message);
        return {
          reply: "抱歉，我没有理解您的问题。",
          isMock: false,
          model: config.ai.model || "step-3.7-flash",
          sources: [],
          tool: { name: null, args: [], result: null },
        };
      }

      const validCalls = (response.toolCalls || []).filter((tc) => tc.function?.name);

      // LLM 直接回答 → 收尾
      if (validCalls.length === 0) {
        return {
          reply: response.content || "抱歉，我没有理解您的问题。",
          isMock: !!response.isMock,
          model: response.model || config.ai.model || "step-3.7-flash",
          sources: [],
          tool: { name: null, args: [], result: null },
        };
      }

      // 执行工具
      const results = [];
      for (const tc of validCalls) {
        let r;
        try {
          r = await this.runTool(tc.function.name, parseToolArgs(tc.function.arguments), { userId: options.userId });
        } catch (err) {
          r = `工具执行失败: ${err.message}`;
        }
        results.push({ tc, result: r });
      }
      toolSummary.push(validCalls.map((t) => t.function.name).join(","));

      // 工具结果回注
      messages = [
        ...messages,
        { role: "assistant", content: null, tool_calls: toAssistantToolCalls(validCalls) },
        ...results.map(({ tc, result }) => ({
          role: "tool",
          tool_call_id: tc.id,
          content: String(result).substring(0, 4000),
        })),
      ];

      // 无进展检测：连续 2 轮相同工具调用 → 强制收尾
      const signature = validCalls.map((t) => `${t.function.name}:${t.function.arguments}`).join("|");
      if (signature === lastSignature) {
        repeatCount++;
        if (repeatCount >= 2) {
          console.warn(`[Agent] 检测到无进展循环（${signature}），强制收尾`);
          messages = [
            ...messages,
            { role: "user", content: "你已多次调用相同工具。请基于已有信息直接给出最终回答，不要再调用任何工具。" },
          ];
          break;
        }
      } else {
        lastSignature = signature;
        repeatCount = 1;
      }
    }

    // 收尾生成：不带 tools，强制基于已回注的工具结果给出最终答案
    const final = await this.aiService.getCompletion("", [], { messages });

    return {
      reply: final.content,
      isMock: !!final.isMock,
      model: final.model || config.ai.model || "step-3.7-flash",
      sources: [],
      tool: {
        name: toolSummary.join(";") || null,
        args: [],
        result: null,
      },
    };
  }
}

module.exports = { AgentService, SYSTEM_PROMPT, buildDecisionMessages, buildMemorySummary, parseToolArgs };
