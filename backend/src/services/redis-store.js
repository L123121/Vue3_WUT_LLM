"use strict";

const Redis = require('ioredis');

/**
 * RedisStore — 真正的 Redis 实现
 *
 * API 与 MemoryStore 完全一致，可无缝替换。
 * 所有 hash 值自动 JSON 序列化/反序列化，保持与 MemoryStore 行为一致。
 */
class RedisStore {
  constructor(url) {
    this._redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null; // 停止重试
        return Math.min(times * 200, 2000); // 递增延迟
      },
      lazyConnect: false,
    });

    this._redis.on('connect', () => console.log('[Redis] 已连接'));
    this._redis.on('error', (err) => console.error('[Redis] 连接错误:', err.message));
  }

  // ==================== Pipeline ====================

  pipeline() {
    const pipe = this._redis.pipeline();
    return {
      sadd: (k, v) => pipe.sadd(k, v),
      srem: (k, v) => pipe.srem(k, v),
      smembers: (k) => pipe.smembers(k),
      scard: (k) => pipe.scard(k),
      hset: (k, ...args) => pipe.hset(k, ...args),
      hdel: (k, f) => pipe.hdel(k, f),
      hgetall: (k) => pipe.hgetall(k),
      hget: (k, f) => pipe.hget(k, f),
      rpush: (k, v) => pipe.rpush(k, v),
      lrange: (k, start, end) => pipe.lrange(k, start, end),
      llen: (k) => pipe.llen(k),
      ltrim: (k, start, end) => pipe.ltrim(k, start, end),
      del: (k) => pipe.del(k),
      expire: (k, ttl) => pipe.expire(k, ttl),
      exec: () => pipe.exec().then(results =>
        results.map(([err, val]) => [err, val])
      ),
    };
  }

  // ==================== Set 操作 ====================

  async sadd(key, value) {
    return this._redis.sadd(key, value);
  }

  async srem(key, value) {
    return this._redis.srem(key, value);
  }

  async smembers(key) {
    return this._redis.smembers(key);
  }

  async scard(key) {
    return this._redis.scard(key);
  }

  async sismember(key, value) {
    return this._redis.sismember(key, value);
  }

  // ==================== Hash 操作 ====================

  async hset(key, ...args) {
    if (args.length === 1 && typeof args[0] === 'object') {
      // 对象形式：值需要 JSON 序列化
      const obj = args[0];
      const serialized = {};
      for (const [k, v] of Object.entries(obj)) {
        serialized[k] = JSON.stringify(v);
      }
      return this._redis.hset(key, serialized);
    }
    // key-value 对形式
    const serialized = [];
    for (let i = 0; i < args.length; i += 2) {
      serialized.push(args[i], JSON.stringify(args[i + 1]));
    }
    return this._redis.hset(key, ...serialized);
  }

  async hgetall(key) {
    const result = await this._redis.hgetall(key);
    if (!result || Object.keys(result).length === 0) return null;
    // 反序列化所有值
    const decoded = {};
    for (const [k, v] of Object.entries(result)) {
      try { decoded[k] = JSON.parse(v); } catch { decoded[k] = v; }
    }
    return decoded;
  }

  async hget(key, field) {
    const val = await this._redis.hget(key, field);
    if (val === null || val === undefined) return null;
    try { return JSON.parse(val); } catch { return val; }
  }

  async hdel(key, field) {
    return this._redis.hdel(key, field);
  }

  // ==================== List 操作 ====================

  async rpush(key, value) {
    return this._redis.rpush(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  async lrange(key, start, end) {
    return this._redis.lrange(key, start, end);
  }

  async llen(key) {
    return this._redis.llen(key);
  }

  async ltrim(key, start, end) {
    return this._redis.ltrim(key, start, end);
  }

  // ==================== Key 操作 ====================

  async del(key) {
    return this._redis.del(key);
  }

  // ==================== 其他 ====================

  async expire(key, ttl) {
    return this._redis.expire(key, ttl);
  }

  // ==================== 状态 ====================

  get status() {
    return this._redis.status;
  }

  async quit() {
    return this._redis.quit();
  }
}

module.exports = { RedisStore };
