"use strict";

const { redis: store } = require("./memory-store");
const config = require("../config");

class QuotaService {
  constructor() {
    this.cfg = config.quota || {};
  }

  _key(userId) {
    return `quota:usage:${userId || "anonymous"}`;
  }

  _today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  _limit(userId) {
    if (userId === "admin") return Infinity; // 管理员无配额限制
    if (!userId) return this.cfg.anonymousLimit ?? 20;
    return this.cfg.dailyLimit ?? 100;
  }

  async getUsage(userId) {
    const key = this._key(userId);
    const limit = this._limit(userId);
    const today = this._today();
    const raw = await store.hgetall(key);
    const storedDate = raw?.date;
    const count = parseInt(raw?.count, 10) || 0;
    if (storedDate !== today) {
      return { used: 0, limit, remaining: limit, date: today, resetAt: today + "T23:59:59+08:00" };
    }
    return { used: count, limit, remaining: Math.max(0, limit - count), date: today, resetAt: today + "T23:59:59+08:00" };
  }

  async increment(userId) {
    const key = this._key(userId);
    const today = this._today();
    const raw = await store.hgetall(key);
    const storedDate = raw?.date;
    if (storedDate !== today) {
      await store.hset(key, { date: today, count: 1 });
      return 1;
    }
    const count = (parseInt(raw?.count, 10) || 0) + 1;
    await store.hset(key, { date: today, count });
    return count;
  }

  /**
   * 原子地检查并递增配额。
   * 读-改-写全程同步（better-sqlite3 同步 API，单线程内无让出点），
   * 并发请求不可能同时通过检查 → 不会突破日限额。
   * @returns {{ok: boolean, usage: object}} ok=false 表示已达上限（本次不计数）
   */
  incrementIfAllowed(userId) {
    const key = this._key(userId);
    const today = this._today();
    const limit = this._limit(userId);
    if (limit === Infinity) {
      return { ok: true, usage: { used: 0, limit, remaining: Infinity, date: today, resetAt: today + "T23:59:59+08:00" } };
    }
    const raw = store.hgetallSync(key);
    const storedDate = raw?.date;
    const count = storedDate !== today ? 1 : (parseInt(raw?.count, 10) || 0) + 1;
    store.hsetSync(key, 'date', today);
    store.hsetSync(key, 'count', count);
    const usage = { used: count, limit, remaining: Math.max(0, limit - count), date: today, resetAt: today + "T23:59:59+08:00" };
    return { ok: usage.remaining > 0, usage };
  }

  async check(userId) {
    const usage = await this.getUsage(userId);
    return { ok: usage.remaining > 0, usage };
  }
}

module.exports = new QuotaService();
