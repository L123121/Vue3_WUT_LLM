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

// 落盘熔断：连续失败 ≥3 次后，接下来 60s 内跳过 _persist（不发 Redis），
// 避免 Redis 持续宕机时每请求一条 warn 刷屏 + pending Promise 积压。
// 60s 后放行一次探活，成功则复位。
const PERSIST_FAIL_THRESHOLD = 3;
const PERSIST_BREAKER_MS = 60 * 1000;
let _persistFailStreak = 0;
let _persistBreakUntil = 0;

// 路由英文 key → 中文展示名。后端是 route 值的真相源，统一在此映射，
// 通过 toSummary() 下发给前端，前端无需再维护一份同步表。
const ROUTE_LABELS = {
  react: 'ReAct 推理',
  simple: '快捷查询',
  knowledge: '知识库',
  agent: '自主推理',
  chat: '对话',
  analysis: '成绩分析',
};

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
    // 2) 异步落盘，不阻塞响应。熔断期间直接跳过（见模块级 _persistBreakUntil）
    if (Date.now() < _persistBreakUntil) {
      // 熔断中：静默跳过，不再发 Redis 也不再 warn（避免刷屏）
      return trace;
    }
    this._persist(trace)
      .then(() => { _persistFailStreak = 0; }) // 成功则复位失败计数
      .catch((e) => {
        _persistFailStreak++;
        if (_persistFailStreak >= PERSIST_FAIL_THRESHOLD) {
          _persistBreakUntil = Date.now() + PERSIST_BREAKER_MS;
          console.warn(`[AgentTracer] 落盘连续失败 ${_persistFailStreak} 次，熔断 ${PERSIST_BREAKER_MS / 1000}s：${e.message}`);
        } else {
          console.warn('[AgentTracer] 落盘失败:', e.message);
        }
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

  /**
   * 轻量摘要——供 SSE trace 事件回传给前端展示用（推理总览小条）
   * 不含 steps 正文 / message / userId 等敏感或大字段，只给前端需要的展示数据
   */
  toSummary() {
    return {
      route: this.route,
      routeLabel: ROUTE_LABELS[this.route] || this.route || '推理',
      intent: this.intent,
      confidence: this.confidence,
      iterations: this.iterations,
      stepCount: this.steps.length,
      status: this.status,
      totalMs: this.endedAt ? (this.endedAt - this.startedAt) : (Date.now() - this.startedAt),
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
  // 防御：limit<=0 时 lrange(-0,-1) 会返回整个列表（语义错误），直接返回空
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const key = TRACE_KEY(userId);
  const raw = await store.lrange(key, -limit, -1);
  if (!raw || raw.length === 0) return [];
  return raw.map((line) => {
    try { return typeof line === 'string' ? JSON.parse(line) : line; }
    catch { return { _parseError: true }; }
  });
}

module.exports = { AgentTracer, getRecentTraces };
