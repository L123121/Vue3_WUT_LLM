/**
 * chat.controller — 对话控制器（V2.0：意图识别自动路由）
 *
 * V2.0 变更（2026-08-14，面试官反馈①）：
 *   - 移除"前端手动开关 RAG"的前置决策，改为后端意图识别自动路由：
 *     chat 意图 → 纯 LLM（不触发检索，快、省）
 *     rag  意图 → RAG 检索管道（默认兜底，校园问答主场景）
 *     agent意图 → 工具调度（task #5 接入；当前先走 RAG 管道，内部可降级）
 *   - SSE 新增 intent 事件，向前端下发路由结果（前端展示"自动路由：知识库检索"等）
 *   - INTENT_ROUTING_ENABLED=false 时退回原链路（一律 RAG，仅问候语正则跳过）
 *
 * 历史：2026-07-21 移除 Agent 系统，回归 RAG 对话模式（存档在 D:\武理小精灵_agent_存档）。
 */

"use strict";

const { RagService } = require("../services/rag.service");
const { ChatService } = require("../services/chat.service");
const { aiService } = require("../services/ai.service");
const { MemoryService } = require("../services/memory.service");
const { IntentRouter } = require("../services/intent-router.service");
const { AgentService } = require("../services/agent.service");
const config = require("../config");

const ragService = new RagService(aiService);
const chatService = new ChatService(aiService);
const memoryService = new MemoryService();
const intentRouter = new IntentRouter(aiService);
const agentService = new AgentService(aiService);

const INTENT_ROUTING_ENABLED = config.rag?.intentRoutingEnabled !== false;

/**
 * 意图路由分发（非流式）
 * @returns {Promise<{route: string, intent: object}>}
 */
async function routeIntent(message) {
  if (!INTENT_ROUTING_ENABLED) return null;
  try {
    return await intentRouter.route(message);
  } catch (err) {
    console.warn("[Chat] 意图路由失败，按原链路处理:", err.message);
    return null;
  }
}

/**
 * 纯 LLM 闲聊回复（chat 意图）
 */
async function chatReply(message, history) {
  const systemPrompt = "你是一个友好的校园助手，名字叫\"武理小精灵\"，回答要简洁亲切。";
  const chatHistory = [
    { role: "system", content: systemPrompt },
    ...(history || []),
  ];
  const result = await aiService.getCompletion(message, chatHistory);
  return {
    reply: result.content,
    isMock: !!result.isMock,
    sources: [],
    context: "",
    model: result.model || config.ai.model || "step-3.7-flash",
  };
}

/**
 * 非流式聊天接口
 */
const chatHandler = async (req, res, next) => {
  try {
    const { message, history } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, error: "消息内容不能为空" });
    }

    const routing = await routeIntent(message);
    let result;

    if (routing && routing.route === "chat") {
      // 闲聊意图：纯 LLM，不触发检索
      result = await chatReply(message, history || []);
      result.intent = { intent: routing.intent, route: routing.route, confidence: routing.confidence, reason: routing.reason };
    } else if (routing && routing.route === "agent" && agentService.enabled) {
      // Agent 意图且工具层已启用：单轮工具调度
      result = await agentService.chat(message, history || [], {
        userId: req.userId,
        conversationId: req.body?.conversationId || null,
      });
      result.intent = { intent: routing.intent, route: routing.route, confidence: routing.confidence, reason: routing.reason };
    } else {
      // rag（及未启用工具层的 agent）→ RAG 检索管道（内部有降级）
      result = await ragService.chat(message, history || [], {
        traceId: req.traceId,
        userId: req.userId,
        conversationId: req.body?.conversationId || null,
      });
      if (routing) {
        result.intent = { intent: routing.intent, route: routing.route, confidence: routing.confidence, reason: routing.reason };
      }
    }

    memoryService.saveChatMemory(req.userId, message, result.reply);

    res.json({ success: true, data: result });
  } catch (error) {
    console.error("[Chat] 非流式错误:", error);
    next(error);
  }
};

/**
 * 流式聊天接口（SSE）— 意图识别自动路由
 */
const streamHandler = async (req, res, next) => {
  try {
    const { message, history } = req.body;

    if (!message) {
      return res.status(400).json({ error: "消息内容不能为空" });
    }

    const routing = await routeIntent(message);

    // 兼容旧链路：未启用意图路由时，仅问候语正则跳过 RAG（原行为）
    if (!routing) {
      const trimmed = message.trim();
      const isSimpleChat = /^(你好|您好|hi|hello|嗨|hey|在吗|thanks|谢谢|bye|再见|早上好|晚上好|下午好)[!！.。]?$/i.test(trimmed);
      if (isSimpleChat) {
        const result = await chatReply(message, history || []);
        res.setHeader("Content-Type", "application/json");
        res.json({ success: true, data: result });
        memoryService.saveChatMemory(req.userId, message, result.reply);
        return;
      }
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let fullReply = "";

    // 下发意图路由事件（前端展示"自动路由"状态，替代手动 RAG 开关）
    if (routing) {
      res.write(`data: ${JSON.stringify({
        intent: {
          intent: routing.intent,
          route: routing.route,
          confidence: routing.confidence,
          reason: routing.reason,
        },
      })}\n\n`);
    }

    // chat 意图：纯 LLM 流式，不触发检索
    if (routing && routing.route === "chat") {
      const systemPrompt = "你是一个友好的校园助手，名字叫\"武理小精灵\"，回答要简洁亲切。";
      const chatHistory = [
        { role: "system", content: systemPrompt },
        ...(history || []),
      ];
      const stream = aiService.getCompletionStream(message, chatHistory);
      for await (const chunk of stream) {
        if (chunk.done) {
          res.write("data: [DONE]\n\n");
        } else {
          fullReply += chunk.content || "";
          res.write(`data: ${JSON.stringify({ content: chunk.content || "" })}\n\n`);
        }
      }
      res.end();
      memoryService.saveChatMemory(req.userId, message, fullReply);
      return;
    }

    // agent 意图且工具层已启用：多轮工具调度（LLM 决策 → 工具执行 → 生成，含 tracer）
    if (routing && routing.route === "agent" && agentService.enabled) {
      for await (const chunk of agentService.chatStream(message, history || [], {
        traceId: req.traceId,
        userId: req.userId,
        conversationId: req.body?.conversationId || null,
      })) {
        if (chunk.type === "tool_call") {
          res.write(`data: ${JSON.stringify({
            tool_call: { name: chunk.tool_call?.name, arguments: chunk.tool_call?.arguments, reason: chunk.tool_call?.reason },
          })}\n\n`);
        } else if (chunk.type === "tool_result") {
          res.write(`data: ${JSON.stringify({
            tool_result: { name: chunk.tool_result?.name, content: chunk.tool_result?.content, durationMs: chunk.tool_result?.durationMs },
          })}\n\n`);
        } else if (chunk.type === "trace") {
          const t = chunk.trace || {};
          res.write(`data: ${JSON.stringify({
            traceId: t.traceId || req.traceId,
            agent: {
              rounds: t.rounds || 0,
              toolCalls: t.toolCalls || [],
              totalMs: t.totalMs || 0,
              finishReason: t.finishReason || null,
            },
          })}\n\n`);
        } else if (chunk.type === "content") {
          if (chunk.done) {
            res.write("data: [DONE]\n\n");
          } else {
            fullReply += chunk.content || "";
            res.write(`data: ${JSON.stringify({ content: chunk.content || "" })}\n\n`);
          }
        }
      }
      res.end();
      memoryService.saveChatMemory(req.userId, message, fullReply);
      return;
    }

    // rag（及未启用工具层的 agent）→ RAG 检索管道
    for await (const chunk of ragService.chatStream(message, history || [], {
      traceId: req.traceId,
      userId: req.userId,
      conversationId: req.body?.conversationId || null,
    })) {
      if (chunk.type === "retrieval") {
        continue;
      } else if (chunk.type === "sources") {
        res.write(`data: ${JSON.stringify({ sources: chunk.sources })}\n\n`);
      } else if (chunk.type === "trace") {
        const outcome = chunk.trace?.outcome || {};
        res.write(`data: ${JSON.stringify({
          traceId: chunk.trace?.traceId || req.traceId,
          rag: {
            usedRag: outcome.usedRag === true,
            usedParentChild: outcome.usedParentChild === true,
            matchedDocs: outcome.matchedDocs || 0,
            retrievedChunks: outcome.retrievedChunks || 0,
            fallbackReason: outcome.fallbackReason || null,
          },
        })}\n\n`);
      } else if (chunk.type === "content") {
        if (chunk.done) {
          res.write("data: [DONE]\n\n");
        } else {
          fullReply += chunk.content || "";
          res.write(`data: ${JSON.stringify({ content: chunk.content || "" })}\n\n`);
        }
      }
    }

    res.end();

    memoryService.saveChatMemory(req.userId, message, fullReply);
  } catch (error) {
    console.error("[Chat Stream] 错误:", error);
    try {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    } catch (_) {
      // 连接已关闭，忽略
    }
  }
};

module.exports = { chatHandler, streamHandler };
