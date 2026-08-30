"use strict";

const { redis: store } = require('./memory-store');
const {
  compactPayload,
  createTraceId,
  logEvent,
  sanitizeError,
  truncateText,
} = require('./observability.service');
const { recordStageSpan } = require('./otel-tracing.service');

const TRACE_KEEP = parseInt(process.env.RAG_TRACE_KEEP || '50', 10) || 50;
const TRACE_KEY = (userId) => `rag:trace:${userId || 'anonymous'}`;
const PERSIST_FAIL_THRESHOLD = 3;
const PERSIST_BREAKER_MS = 60 * 1000;
let persistFailStreak = 0;
let persistBreakUntil = 0;

class RagTracer {
  constructor({ traceId = null, userId = null, conversationId = null, message = '', category = null } = {}) {
    this.traceId = traceId || createTraceId('rag');
    this.userId = userId;
    this.conversationId = conversationId;
    this.message = message;
    this.category = category;
    this.startedAt = Date.now();
    this.endedAt = null;
    this.status = 'ok';
    this.error = null;
    this.stages = [];
    this.outcome = {};
    this.retrieval = null;
  }

  recordStage(name, durationMs, success = true, details = {}, err = null) {
    this.stages.push({
      name,
      durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
      success: !!success,
      ...compactPayload(details),
      ...(err ? { error: sanitizeError(err) } : {}),
    });
    // OTel 启用时把阶段补成带显式时间戳的子 span（retrieve/rerank/generate…），关闭时 Noop
    recordStageSpan({
      name,
      durationMs,
      success,
      attributes: details,
      traceId: this.traceId,
    });
  }

  setRetrieval(retrieval) {
    this.retrieval = retrieval || null;
  }

  setOutcome(outcome = {}) {
    this.outcome = { ...this.outcome, ...compactPayload(outcome) };
  }

  markError(err) {
    this.status = 'error';
    this.error = sanitizeError(err);
  }

  markFallback(reason) {
    if (this.status === 'ok') this.status = 'fallback';
    if (!this.outcome.fallbackReason) this.outcome.fallbackReason = truncateText(reason, 120);
  }

  finish(extraOutcome = {}) {
    if (Object.keys(extraOutcome).length > 0) this.setOutcome(extraOutcome);
    if (!this.endedAt) this.endedAt = Date.now();
    const trace = this.toJSON();

    logEvent(this.status === 'error' ? 'error' : 'info', 'rag_trace', trace);

    if (Date.now() < persistBreakUntil) return trace;
    this._persist(trace)
      .then(() => { persistFailStreak = 0; })
      .catch((err) => {
        persistFailStreak++;
        if (persistFailStreak >= PERSIST_FAIL_THRESHOLD) {
          persistBreakUntil = Date.now() + PERSIST_BREAKER_MS;
          console.warn(`[RAGTracer] 落盘连续失败 ${persistFailStreak} 次，熔断 ${PERSIST_BREAKER_MS / 1000}s：${err.message}`);
        } else {
          console.warn('[RAGTracer] 落盘失败:', err.message);
        }
      });
    return trace;
  }

  toJSON() {
    return {
      traceId: this.traceId,
      userId: this.userId,
      conversationId: this.conversationId,
      message: truncateText(this.message, 120),
      category: this.category,
      status: this.status,
      stages: this.stages,
      retrieval: this.retrieval,
      outcome: this.outcome,
      error: this.error,
      totalMs: this.endedAt ? (this.endedAt - this.startedAt) : (Date.now() - this.startedAt),
      startedAt: new Date(this.startedAt).toISOString(),
    };
  }

  toSummary() {
    const finished = this.endedAt || Date.now();
    const failedStages = this.stages.filter(stage => !stage.success);
    return {
      traceId: this.traceId,
      status: this.status,
      totalMs: finished - this.startedAt,
      stageCount: this.stages.length,
      failedStageCount: failedStages.length,
      failedStages: failedStages.map(stage => ({ name: stage.name, error: stage.error })),
      timings: this.stages.map(stage => ({ name: stage.name, durationMs: stage.durationMs, success: stage.success })),
      retrieval: this.retrieval,
      outcome: this.outcome,
      startedAt: new Date(this.startedAt).toISOString(),
    };
  }

  async _persist(trace) {
    const key = TRACE_KEY(this.userId);
    const line = JSON.stringify(trace);
    await store.rpush(key, line);
    if (typeof store.ltrim === 'function') {
      await store.ltrim(key, -TRACE_KEEP, -1);
    }
  }
}

async function getRecentRagTraces(userId, limit = 20) {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const key = TRACE_KEY(userId);
  const raw = await store.lrange(key, -limit, -1);
  if (!raw || raw.length === 0) return [];
  return raw.map((line) => {
    try { return typeof line === 'string' ? JSON.parse(line) : line; }
    catch { return { _parseError: true }; }
  });
}

module.exports = { RagTracer, getRecentRagTraces };

