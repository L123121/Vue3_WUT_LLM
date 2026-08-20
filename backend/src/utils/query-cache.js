"use strict";

/**
 * LRU + TTL 通用缓存
 *
 * 纯 Map 实现，零外部依赖。用于检索结果缓存、reranker 分数缓存等场景。
 *
 * API:
 *   cache.get(key)       → value | undefined
 *   cache.set(key, value, [ttlMs])  → void
 *   cache.has(key)       → boolean
 *   cache.clear()        → void
 *   cache.stats          → { size, hits, misses, hitRate }
 */
class QueryCache {
  /**
   * @param {number} maxSize - 最大条目数（LRU 淘汰上限）
   * @param {number} defaultTtlMs - 默认 TTL（毫秒）
   */
  constructor(maxSize = 500, defaultTtlMs = 300000) {
    this._max = maxSize;
    this._ttl = defaultTtlMs;
    this._map = new Map(); // key → { value, expiresAt }
    this._hits = 0;
    this._misses = 0;
  }

  /** 获取缓存值，LRU 命中后移到最新 */
  get(key) {
    const entry = this._map.get(key);
    if (!entry) {
      this._misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this._map.delete(key);
      this._misses++;
      return undefined;
    }
    // LRU: 删掉再插，移到最新
    this._map.delete(key);
    this._map.set(key, entry);
    this._hits++;
    return entry.value;
  }

  /** 写入缓存，TTL 可覆盖默认值 */
  set(key, value, ttlMs) {
    const ttl = typeof ttlMs === 'number' ? ttlMs : this._ttl;
    this._purgeExpired();
    if (this._map.has(key)) this._map.delete(key);
    while (this._map.size >= this._max) {
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
    }
    this._map.set(key, { value, expiresAt: Date.now() + ttl });
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  /** 清空缓存 */
  clear() {
    this._map.clear();
    this._hits = 0;
    this._misses = 0;
  }

  /** 统计信息 */
  get stats() {
    const total = this._hits + this._misses;
    return {
      size: this._map.size,
      hits: this._hits,
      misses: this._misses,
      hitRate: total > 0 ? this._hits / total : 0,
    };
  }

  /** 清理已过期条目 */
  _purgeExpired() {
    const now = Date.now();
    for (const [k, v] of this._map) {
      if (now > v.expiresAt) this._map.delete(k);
    }
  }
}

module.exports = { QueryCache };
