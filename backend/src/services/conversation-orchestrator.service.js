"use strict";

const { AiService } = require("./ai.service");
const { RagService } = require("./rag.service");
const { MemoryService } = require("./memory.service");
const { IntentRouter } = require("./intent-router.service");
const { AgentService } = require("./agent.service");
const config = require("../config");

const SIMPLE_CHAT_RE = /^(你好|您好|hi|hello|嗨|hey|在吗|thanks|谢谢|bye|再见|早上好|晚上好|下午好)[!！.。]?$/i;

class ConversationOrchestrator {
  constructor(dependencies = {}) {
    this.aiService = dependencies.aiService || new AiService();
    this.ragService = dependencies.ragService || new RagService(this.aiService);
    this.memoryService = dependencies.memoryService || new MemoryService();
    this.intentRouter = dependencies.intentRouter || new IntentRouter(this.aiService);
    this.agentService = dependencies.agentService || new AgentService(this.aiService);
    this.intentRoutingEnabled = dependencies.intentRoutingEnabled
      ?? config.rag?.intentRoutingEnabled !== false;
  }

  async routeIntent(message) {
    if (!this.intentRoutingEnabled) return null;
    try {
      return await this.intentRouter.route(message);
    } catch (err) {
      console.warn("[Conversation] 意图路由失败，按默认链路处理:", err.message);
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
    const route = routing?.route || (SIMPLE_CHAT_RE.test(String(message || "").trim()) ? "chat" : "rag");
    return { routing, route, history: enrichedHistory };
  }

  async _readMemory(userId, message) {
    if (!userId) return "";
    try {
      return await this.memoryService.buildMemoryContext(userId, message);
    } catch (err) {
      console.warn("[Conversation Memory] 读取失败:", err.message);
      return "";
    }
  }

  _saveMemory(userId, message, reply) {
    if (!userId || !reply) return;
    try {
      this.memoryService.saveChatMemory(userId, message, reply);
    } catch (err) {
      console.warn("[Conversation Memory] 保存失败:", err.message);
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
    } else if (prepared.route === "agent" && this.agentService.enabled) {
      try {
        result = await this.agentService.chat(message, prepared.history, context);
      } catch (err) {
        if (!err?.agentShouldFallback) throw err;
        console.warn("[Conversation] Agent 失败，降级 RAG:", err.message);
        result = await this.ragService.chat(message, prepared.history, context);
        prepared.routing = prepared.routing
          ? { ...prepared.routing, route: "rag", reason: "agent 链路失败，自动降级知识库检索" }
          : null;
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

    if (prepared.route === "agent" && this.agentService.enabled) {
      let agentFailed = false;
      for await (const event of this.agentService.chatStream(message, prepared.history, context)) {
        if (event.type === "error") {
          agentFailed = true;
          console.warn("[Conversation] Agent 流失败，降级 RAG:", event.error?.message);
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
      if (prepared.routing) {
        yield {
          type: "intent",
          intent: {
            ...this._intentResult(prepared.routing),
            route: "rag",
            reason: "agent 链路失败，自动降级知识库检索",
          },
        };
      }
    }

    for await (const event of this.ragService.chatStream(message, prepared.history, context)) {
      if (event.type === "content" && !event.done) fullReply += event.content || "";
      yield event.type === "trace" ? { ...event, channel: "rag" } : event;
    }
    this._saveMemory(context.userId, message, fullReply);
  }
}

module.exports = { ConversationOrchestrator, SIMPLE_CHAT_RE };
