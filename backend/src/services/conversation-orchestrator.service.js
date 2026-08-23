"use strict";

const { AiService } = require("./ai.service");
const { RagService } = require("./rag.service");
const { MemoryService } = require("./memory.service");
const { IntentRouter, INTENT_TYPES, GREETING_PATTERN } = require("./intent-router.service");
const { AgentService } = require("./agent.service");
const { logEvent } = require("./observability.service");
const config = require("../config");

class ConversationOrchestrator {
  constructor(dependencies = {}) {
    this.aiService = dependencies.aiService || new AiService();
    this.ragService = dependencies.ragService || new RagService(this.aiService);
    this.memoryService = dependencies.memoryService || new MemoryService();
    this.intentRouter = dependencies.intentRouter || new IntentRouter(this.aiService);
    this.agentService = dependencies.agentService || new AgentService(this.aiService);
    this.agenticRagService = dependencies.agenticRagService || null;
    this.intentRoutingEnabled = dependencies.intentRoutingEnabled
      ?? config.rag?.intentRoutingEnabled !== false;
  }

  async routeIntent(message) {
    if (!this.intentRoutingEnabled) return null;
    try {
      return await this.intentRouter.route(message);
    } catch (err) {
      logEvent("warn", "conversation_intent_route_failed", { error: err.message });
      return null;
    }
  }

  async _prepare(message, history, context) {
    const safeHistory = Array.isArray(history) ? history : [];
    const [routing, memoryContext] = await Promise.all([
      this.routeIntent(message),
      this._readMemory(context.userId, message),
    ]);
    const enrichedHistory = memoryContext
      ? [
        { role: "system", content: `以下是经用户授权保存的历史信息，仅用于个性化当前回答：\n${memoryContext}` },
        ...safeHistory,
      ]
      : safeHistory;
    const route = routing?.route || (GREETING_PATTERN.test(String(message || "").trim()) ? "chat" : "rag");
    return { routing, route, history: enrichedHistory };
  }

  /**
   * Agent 失败降级后的统一路由描述：
   * 有原始路由 → 改写 route/reason；无原始路由（规则关闭或未命中）→ 合成最小意图，
   * 保证非流式 result.intent 与流式 intent 事件在两条路径上行为一致。
   */
  _agentFallbackRouting(routing) {
    const reason = "agent 链路失败，自动降级知识库检索";
    return routing
      ? { ...routing, route: "rag", reason }
      : {
        intent: INTENT_TYPES.COMPLEX_TASK,
        confidence: 0,
        params: {},
        tool: null,
        route: "rag",
        reason,
      };
  }

  async _readMemory(userId, message) {
    if (!userId) return "";
    try {
      return await this.memoryService.buildMemoryContext(userId, message);
    } catch (err) {
      logEvent("warn", "conversation_memory_read_failed", { error: err.message });
      return "";
    }
  }

  _saveMemory(userId, message, reply) {
    if (!userId || !reply) return;
    try {
      this.memoryService.saveChatMemory(userId, message, reply);
    } catch (err) {
      logEvent("warn", "conversation_memory_save_failed", { error: err.message });
    }
  }

  _intentResult(routing) {
    if (!routing) return null;
    return {
      intent: routing.intent,
      route: routing.route,
      confidence: routing.confidence,
      reason: routing.reason,
    };
  }

  async _chatReply(message, history) {
    const systemPrompt = "你是一个友好的校园助手，名字叫\"武理小精灵\"，回答要简洁亲切。";
    const result = await this.aiService.getCompletion(message, [
      { role: "system", content: systemPrompt },
      ...history,
    ]);
    return {
      reply: result.content,
      isMock: !!result.isMock,
      sources: [],
      context: "",
      model: result.model || config.ai.model || "step-3.7-flash",
    };
  }

  async chat(message, history = [], context = {}) {
    const prepared = await this._prepare(message, history, context);
    let result;

    if (prepared.route === "chat") {
      result = await this._chatReply(message, prepared.history);
    } else if (prepared.route === "rag" && this.agenticRagService?.enabled) {
      result = await this.agenticRagService.chat(message, prepared.history, context);
    } else if (prepared.route === "agent" && this.agentService.enabled) {
      try {
        result = await this.agentService.chat(message, prepared.history, context);
      } catch (err) {
        if (!err?.agentShouldFallback) throw err;
        logEvent("warn", "conversation_agent_fallback", { error: err.message });
        result = await this.ragService.chat(message, prepared.history, context);
        prepared.routing = this._agentFallbackRouting(prepared.routing);
      }
    } else {
      result = await this.ragService.chat(message, prepared.history, context);
    }

    const intent = this._intentResult(prepared.routing);
    if (intent) result.intent = intent;
    this._saveMemory(context.userId, message, result.reply);
    return result;
  }

  async *chatStream(message, history = [], context = {}) {
    const prepared = await this._prepare(message, history, context);
    let fullReply = "";

    if (prepared.routing) {
      yield { type: "intent", intent: this._intentResult(prepared.routing) };
    }

    if (prepared.route === "chat") {
      const systemPrompt = "你是一个友好的校园助手，名字叫\"武理小精灵\"，回答要简洁亲切。";
      const stream = this.aiService.getCompletionStream(message, [
        { role: "system", content: systemPrompt },
        ...prepared.history,
      ], { signal: context.signal });
      for await (const chunk of stream) {
        if (chunk.done) {
          yield { type: "content", content: "", done: true };
        } else if (chunk.content) {
          fullReply += chunk.content;
          yield { type: "content", content: chunk.content, done: false };
        }
      }
      this._saveMemory(context.userId, message, fullReply);
      return;
    }

    if (prepared.route === "rag" && this.agenticRagService?.enabled) {
      for await (const event of this.agenticRagService.chatStream(message, prepared.history, context)) {
        if (event.type === "content" && !event.done) fullReply += event.content || "";
        yield event.type === "trace"
          ? { ...event, channel: event.channel || "agentic_rag" }
          : event;
      }
      this._saveMemory(context.userId, message, fullReply);
      return;
    }

    if (prepared.route === "agent" && this.agentService.enabled) {
      let agentFailed = false;
      for await (const event of this.agentService.chatStream(message, prepared.history, context)) {
        if (event.type === "error") {
          agentFailed = true;
          logEvent("warn", "conversation_agent_stream_fallback", { error: event.error?.message });
          break;
        }
        if (event.type === "content" && !event.done) fullReply += event.content || "";
        yield event.type === "trace" ? { ...event, channel: "agent" } : event;
      }
      if (!agentFailed) {
        this._saveMemory(context.userId, message, fullReply);
        return;
      }
      fullReply = "";
      prepared.routing = this._agentFallbackRouting(prepared.routing);
      yield { type: "intent", intent: this._intentResult(prepared.routing) };
    }

    for await (const event of this.ragService.chatStream(message, prepared.history, context)) {
      if (event.type === "content" && !event.done) fullReply += event.content || "";
      yield event.type === "trace" ? { ...event, channel: "rag" } : event;
    }
    this._saveMemory(context.userId, message, fullReply);
  }
}

module.exports = { ConversationOrchestrator };
