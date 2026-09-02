"use strict";

const { applicationContainer } = require("../bootstrap/container");
const { recordAudit } = require('../services/quality-governance.service');

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeStreamEvent(res, event, fallbackTraceId) {
  if (event.type === "retrieval") {
    // 检索阶段事件：与 rag.controller 相同形状，前端 onTrace 消费
    writeSse(res, { traceId: event.traceId || fallbackTraceId, retrieval: event.retrieval, trace: event.trace });
  } else if (event.type === "intent") {
    writeSse(res, { intent: event.intent });
  } else if (event.type === "sources") {
    writeSse(res, { sources: event.sources });
  } else if (event.type === "tool_call") {
    writeSse(res, { tool_call: event.tool_call });
  } else if (event.type === "tool_result") {
    writeSse(res, {
      tool_result: {
        name: event.tool_result?.name,
        content: event.tool_result?.uiSummary || event.tool_result?.content,
        durationMs: event.tool_result?.durationMs,
      },
    });
  } else if (event.type === "process") {
    writeSse(res, { traceId: fallbackTraceId, processCard: event.processCard });
  } else if (event.type === "trace" && event.channel === "agentic_rag") {
    const trace = event.trace || {};
    writeSse(res, {
      traceId: trace.traceId || fallbackTraceId,
      agenticRag: {
        rounds: trace.rounds || 0,
        queries: trace.queries || [],
        toolCalls: trace.toolCalls || [],
        matchedDocs: trace.matchedDocs || 0,
        totalMs: trace.totalMs || 0,
        finishReason: trace.finishReason || null,
        fallbackReason: trace.fallbackReason || null,
      },
    });
  } else if (event.type === "trace" && event.channel === "agent") {
    const trace = event.trace || {};
    writeSse(res, {
      traceId: trace.traceId || fallbackTraceId,
      agent: {
        rounds: trace.rounds || 0,
        toolCalls: trace.toolCalls || [],
        totalMs: trace.totalMs || 0,
        finishReason: trace.finishReason || null,
      },
    });
  } else if (event.type === "trace") {
    const outcome = event.trace?.outcome || {};
    writeSse(res, {
      traceId: event.trace?.traceId || fallbackTraceId,
      rag: {
        usedRag: outcome.usedRag === true,
        usedParentChild: outcome.usedParentChild === true,
        matchedDocs: outcome.matchedDocs || 0,
        retrievedChunks: outcome.retrievedChunks || 0,
        fallbackReason: outcome.fallbackReason || null,
      },
    });
  } else if (event.type === "grounding") {
    // 运行时引用校验：溯源覆盖率随收尾下发（与 rag.controller 形状一致）
    writeSse(res, { traceId: fallbackTraceId, grounding: event.grounding });
  } else if (event.type === "usage") {
    // token 用量随收尾下发
    writeSse(res, { usage: event.usage });
  } else if (event.type === "followups") {
    // 追问建议随收尾下发
    writeSse(res, { traceId: fallbackTraceId, followups: event.items });
  } else if (event.type === "content") {
    if (event.done) res.write("data: [DONE]\n\n");
    // decision: true 标记 agent 决策阶段内容 → 前端渲染到"思考草稿区"，
    // 出现 tool_call 时前端丢弃草稿（详见 agent.service chatStream）
    else if (event.decision) writeSse(res, { content: event.content || "", decision: true });
    else writeSse(res, { content: event.content || "" });
  }
}

function createChatHandlers(conversationOrchestrator) {
  const streamHandler = async (req, res, next) => {
    let abortController = null;
    let onClientClose = null;
    const cleanupClientClose = () => {
      if (onClientClose) res.removeListener("close", onClientClose);
    };

    try {
      const { message, history } = req.body;
      if (!message) return res.status(400).json({ error: "消息内容不能为空" });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      abortController = new AbortController();
      onClientClose = () => abortController.abort();
      res.on("close", onClientClose);

      const context = {
        traceId: req.traceId,
        userId: req.userId,
        conversationId: req.body?.conversationId || null,
        signal: abortController.signal,
      };
      const audit = { answer: '', sources: [], traceId: req.traceId };
      // agent 决策草稿：tool_call 出现即被废弃，不计入审计答案
      let decisionDraft = '';
      for await (const event of conversationOrchestrator.chatStream(message, history || [], context)) {
        if (event.type === 'content' && !event.done) {
          if (event.decision) decisionDraft += event.content || '';
          else { audit.answer += event.content || ''; decisionDraft = ''; }
        }
        if (event.type === 'tool_call') decisionDraft = '';
        if (event.type === 'sources') audit.sources = event.sources || [];
        if (event.type === 'trace' && event.trace?.traceId) audit.traceId = event.trace.traceId;
        writeStreamEvent(res, event, req.traceId);
      }

      void recordAudit({
        question: message,
        answer: audit.answer || decisionDraft,
        sources: audit.sources,
        traceId: audit.traceId,
        userId: req.userId,
        route: audit.sources.length ? 'rag-stream' : 'chat-stream',
      }).catch((error) => console.warn('[QualityAudit] 流式记录失败:', error.message));
      cleanupClientClose();
      res.end();
    } catch (error) {
      cleanupClientClose();
      if (abortController?.signal.aborted) return;
      console.error("[Chat Stream] 错误:", error);
      if (!res.headersSent) return next(error);
      try {
        writeSse(res, { error: error.message });
        res.end();
      } catch {
        // 连接已关闭，忽略
      }
    }
  };

  return { streamHandler };
}

const { streamHandler } = createChatHandlers(applicationContainer.conversationOrchestrator);

module.exports = { createChatHandlers, streamHandler, writeStreamEvent };
