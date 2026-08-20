import { describe, it, expect } from 'vitest';
"use strict";

const { QueryCache } = require('../src/utils/query-cache');

describe('QueryCache', () => {
  /** 创建一个容量 3、TTL 500ms 的缓存 */
  function createCache() {
    return new QueryCache(3, 500);
  }

  describe('basic get/set', () => {
    it('set 后能 get 到值', () => {
      const cache = createCache();
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
    });

    it('不存在的 key 返回 undefined', () => {
      const cache = createCache();
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('has 返回 true/false', () => {
      const cache = createCache();
      cache.set('x', 'val');
      expect(cache.has('x')).toBe(true);
      expect(cache.has('y')).toBe(false);
    });
  });

  describe('TTL 过期', () => {
    it('TTL 过期后返回 undefined', async () => {
      const cache = new QueryCache(10, 50); // 50ms TTL
      cache.set('k', 'v');
      expect(cache.get('k')).toBe('v');

      await new Promise(r => setTimeout(r, 100));
      expect(cache.get('k')).toBeUndefined();
    });

    it('过期条目不计入 stats.hits', async () => {
      const cache = new QueryCache(10, 50);
      cache.set('k', 'v');
      expect(cache.get('k')).toBe('v'); // hit
      await new Promise(r => setTimeout(r, 100));
      expect(cache.get('k')).toBeUndefined(); // miss
      expect(cache.stats.hits).toBe(1);
      expect(cache.stats.misses).toBe(1);
      expect(cache.stats.hitRate).toBe(0.5);
    });
  });

  describe('LRU 淘汰', () => {
    it('超过 maxSize 时淘汰最旧的条目', () => {
      const cache = createCache(); // max 3
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // 填满后第 4 个应淘汰最旧的 'a'
      cache.set('d', 4);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('get 后该 key 变成最新（LRU）', () => {
      const cache = createCache(); // max 3
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // 访问 a，使其变成最新
      cache.get('a');
      // 加入 d，应淘汰 b（最旧）
      cache.set('d', 4);
      expect(cache.get('a')).toBe(1); // 仍存在
      expect(cache.get('b')).toBeUndefined(); // 被淘汰
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });
  });

  describe('覆盖写入', () => {
    it('set 同 key 会覆盖旧值', () => {
      const cache = new QueryCache(2);
      cache.set('k', 'old');
      cache.set('k', 'new');
      expect(cache.get('k')).toBe('new');
    });
  });

  describe('clear', () => {
    it('clear 后所有 key 丢失，stats 归零', () => {
      const cache = createCache();
      cache.set('a', 1);
      cache.set('b', 2);
      cache.get('a');
      cache.clear();
      expect(cache.get('a')).toBeUndefined(); // miss
      expect(cache.stats.size).toBe(0);
      expect(cache.stats.hits).toBe(0);
      expect(cache.stats.misses).toBe(1); // clear 后的 get 产生 1 次 miss
      expect(cache.stats.hitRate).toBe(0);
    });
  });

  describe('stats', () => {
    it('hitRate 初始为 0', () => {
      const cache = createCache();
      expect(cache.stats.hitRate).toBe(0);
    });

    it('连续 miss 时 hitRate 为 0', () => {
      const cache = createCache();
      cache.get('x');
      cache.get('y');
      expect(cache.stats.hits).toBe(0);
      expect(cache.stats.misses).toBe(2);
      expect(cache.stats.hitRate).toBe(0);
    });
  });

  describe('set 自定义 TTL', () => {
    it('set(key, val, ttl) 覆盖默认 TTL', async () => {
      const cache = new QueryCache(10, 200); // 默认 200ms
      cache.set('k', 'v', 50); // 自定义 50ms
      expect(cache.get('k')).toBe('v');
      await new Promise(r => setTimeout(r, 80));
      expect(cache.get('k')).toBeUndefined();
    });
  });

  describe('空值处理', () => {
    it('能存储和检索 falsy 值（0, false, "")', () => {
      const cache = createCache();
      cache.set('zero', 0);
      cache.set('false', false);
      cache.set('empty', '');
      expect(cache.get('zero')).toBe(0);
      expect(cache.get('false')).toBe(false);
      expect(cache.get('empty')).toBe('');
    });
  });
});
