"use strict";

/**
 * SSE 事件 → 线上格式的唯一映射层
 *
 * 此前 chat.controller（编排器路径）与 rag.controller（RAG 直连路径）各自维护
 * 一份事件写出逻辑，形状只能靠注释约定"与对方相同"，是文档里点名要消灭的
 * drift 风险。现统一到本模块：两个控制器消费同一份 chatStream 事件协议，
 * 前端 useStreaming 对 agent/agenticRag/rag 三种 trace 形状均兼容。
 */

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeStreamEvent(res, event, fallbackTraceId) {
  if (event.type === "retrieval") {
    // 检索阶段事件：前端 onTrace 消费
    writeSse(res, { traceId: event.traceId || fallbackTraceId, retrieval: event.retrieval, trace: event.trace });
  } else if (event.type === "intent") {
    writeSse(res, { intent: event.intent });
  } else if (event.type === "sources") {
    writeSse(res, { traceId: fallbackTraceId, sources: event.sources });
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
    // 运行时引用校验：溯源覆盖率随收尾下发
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

module.exports = { writeSse, writeStreamEvent };
