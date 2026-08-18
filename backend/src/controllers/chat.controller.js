"use strict";

const { applicationContainer } = require("../bootstrap/container");

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeStreamEvent(res, event, fallbackTraceId) {
  if (event.type === "retrieval") return;
  if (event.type === "intent") {
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
  } else if (event.type === "content") {
    if (event.done) res.write("data: [DONE]\n\n");
    else writeSse(res, { content: event.content || "" });
  }
}

function createChatHandlers(conversationOrchestrator) {
  const chatHandler = async (req, res, next) => {
    try {
      const { message, history } = req.body;
      if (!message) {
        return res.status(400).json({ success: false, error: "消息内容不能为空" });
      }

      const result = await conversationOrchestrator.chat(message, history || [], {
        traceId: req.traceId,
        userId: req.userId,
        conversationId: req.body?.conversationId || null,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      console.error("[Chat] 非流式错误:", error);
      next(error);
    }
  };

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
      for await (const event of conversationOrchestrator.chatStream(message, history || [], context)) {
        writeStreamEvent(res, event, req.traceId);
      }

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

  return { chatHandler, streamHandler };
}

const { chatHandler, streamHandler } = createChatHandlers(applicationContainer.conversationOrchestrator);

module.exports = { createChatHandlers, chatHandler, streamHandler, writeStreamEvent };
