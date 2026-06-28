"use strict";

const { redis: store } = require('../memory-store');
const { parseRedisList } = require('./helpers');

const MAX_SHORT_TERM = 5;

class ShortTermMemory {
  async save(userId, summary) {
    const key = `memory:${userId}:short_term`;
    const raw = await store.lrange(key, 0, -1);
    const list = parseRedisList(raw);

    list.push({
      content: summary,
      timestamp: new Date().toISOString(),
    });

    while (list.length > MAX_SHORT_TERM) {
      list.shift();
    }

    await store.del(key);
    await store.rpush(key, JSON.stringify(list));
  }

  async get(userId) {
    const key = `memory:${userId}:short_term`;
    const raw = await store.lrange(key, 0, -1);
    const list = parseRedisList(raw);

    if (list.length === 0) return '';
    return list.map((m, i) => `[${i + 1}] ${m.content}`).join('\n');
  }

  async clear(userId) {
    await store.del(`memory:${userId}:short_term`);
  }
}

module.exports = { ShortTermMemory };
