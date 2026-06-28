"use strict";

/**
 * 从 Redis 列表中解析 JSON 数组
 * 处理 MemoryStore 中 rpush 后 lrange 返回的反序列化问题
 */
function parseRedisList(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const first = raw[0];
  if (typeof first === 'string') {
    try { return JSON.parse(first); } catch { return []; }
  }
  if (Array.isArray(first)) return first;
  return [];
}

module.exports = { parseRedisList };
