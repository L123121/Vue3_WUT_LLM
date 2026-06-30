"use strict";

/**
 * AgentTracer — Agent 运行轨迹记录器
 *
 * 每次 chatStream 调用创建一个 Tracer 实例，结构化记录：
 *   - 路由信息（route / intent / confidence）
 *   - 每一步工具调用（tool / args / durationMs / success / error）
 *   - 总耗时、迭代次数、最终状态（ok / timeout / error / aborted）
 *
 * 落盘：写入存储层（Redis 生产 / 内存本地），key = agent:trace:<userId>
 *       保留最近 N 条（list + ltrim）。同时输出一行结构化 JSON 到 console，
 *       便于 docker logs / journalctl 检索。
 *
 * 用途：生产环境调试"为什么 Agent 这次答错了"——可回溯某次问答走过的
 *       route、调了哪些工具、第几步出错、耗时分布。
 */
const { redis: store } = require('./memory-store');

const TRACE_KEEP = 50; // 每用户保留最近 50 条 trace
const TRACE_KEY = (userId) => `agent:trace:${userId || 'anonymous'}`;

class AgentTracer {
  constructor({ userId = null, conversationId = null, message = '' } = {}) {
    this.userId = userId;
    this.conversationId = conversationId;
    this.message = message;
    this.startedAt = Date.now();
    this.endedAt = null;

    this.route = null;
    this.intent = null;
    this.confidence = null;
    this.iterations = 0;
    this.steps = []; // [{ tool, args, durationMs, success, error }]
    this.status = 'ok'; // ok | timeout | error | aborted
    this.error = null;
  }

  setRouting(routing) {
    if (!routing) return;
    this.route = routing.route;
    this.intent = routing.intent;
    this.confidence = routing.confidence;
  }

  setIterations(n) {
    this.iterations = n;
  }

  /**
   * 记录一次工具调用
   * @param {string} tool
   * @param {object} args
   * @param {number} durationMs
   * @param {boolean} success
   * @param {string} [error]
   */
  recordToolCall(tool, args, durationMs, success, error) {
    this.steps.push({
      tool,
      // 截断参数避免 trace 过大
      args: this._truncateArgs(args),
      durationMs,
      success: !!success,
      ...(error ? { error: String(error).substring(0, 300) } : {}),
    });
  }

  markTimeout() { this.status = 'timeout'; }
  markAborted() { this.status = 'aborted'; }
  markError(err) {
    this.status = 'error';
    // 不泄漏上游内部细节，仅保留概要
    this.error = this._sanitizeError(err);
  }

  finish() {
    this.endedAt = Date.now();
    const trace = this.toJSON();
    // 1) console 一行结构化 JSON（docker logs 友好）
    try {
      console.log(`[AgentTrace] ${JSON.stringify(trace)}`);
    } catch { /* 序列化失败忽略 */ }
    // 2) 异步落盘，不阻塞响应
    this._persist(trace).catch((e) => {
      console.warn('[AgentTracer] 落盘失败:', e.message);
    });
    return trace;
  }

  toJSON() {
    return {
      conversationId: this.conversationId,
      userId: this.userId,
      message: (this.message || '').substring(0, 120),
      route: this.route,
      intent: this.intent,
      confidence: this.confidence,
      iterations: this.iterations,
      status: this.status,
      stepCount: this.steps.length,
      steps: this.steps,
      error: this.error,
      totalMs: this.endedAt ? (this.endedAt - this.startedAt) : (Date.now() - this.startedAt),
      startedAt: new Date(this.startedAt).toISOString(),
    };
  }

  // ==================== 内部 ====================

  _truncateArgs(args) {
    try {
      const str = JSON.stringify(args || {});
      if (str.length <= 200) return args;
      return { _truncated: str.substring(0, 200) + '...' };
    } catch {
      return { _unserializable: true };
    }
  }

  _sanitizeError(err) {
    if (!err) return null;
    const msg = err.message || String(err);
    // 去掉可能的 URL / 内部路径
    return msg.replace(/https?:\/\/[^\s]+/g, '[url]').substring(0, 300);
  }

  async _persist(trace) {
    const key = TRACE_KEY(this.userId);
    const line = JSON.stringify(trace);
    await store.rpush(key, line);
    // 仅保留最近 TRACE_KEEP 条
    if (typeof store.ltrim === 'function') {
      await store.ltrim(key, -TRACE_KEEP, -1);
    }
  }
}

/**
 * 读取某用户最近的 trace 列表（供调试接口 / 运维使用）
 * @param {string} userId
 * @param {number} limit
 */
async function getRecentTraces(userId, limit = 20) {
  const key = TRACE_KEY(userId);
  const raw = await store.lrange(key, -limit, -1);
  if (!raw || raw.length === 0) return [];
  return raw.map((line) => {
    try { return typeof line === 'string' ? JSON.parse(line) : line; }
    catch { return { _parseError: true }; }
  });
}

module.exports = { AgentTracer, getRecentTraces };
