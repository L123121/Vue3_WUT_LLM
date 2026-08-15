"use strict";

const { redis: store } = require('../memory-store');
const { EmbeddingService } = require('../embedding.service');
const { parseRedisList } = require('./helpers');

const MAX_LONG_TERM = 100;
const KEYWORD_BOOST = 0.3;
const mutationQueues = new Map();

function withMemoryLock(key, task) {
  const previous = mutationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  mutationQueues.set(key, current);
  return current.finally(() => {
    if (mutationQueues.get(key) === current) mutationQueues.delete(key);
  });
}

async function replaceList(key, list) {
  await store.del(key);
  if (list.length > 0) await store.rpush(key, JSON.stringify(list));
}

class LongTermMemory {
  constructor() {
    this.embedder = new EmbeddingService();
  }

  /**
   * 添加长期记忆（自动计算 embedding + 去重）
   */
  async add(userId, memory) {
    const key = `memory:${userId}:long_term`;
    const entry = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: memory.type || 'fact',
      content: memory.content,
      source: memory.source || 'conversation',
      confidence: memory.confidence || 0.8,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      accessCount: 0,
      embedding: null,
    };
    await this._computeEmbedding(entry);

    return withMemoryLock(key, async () => {
      const raw = await store.lrange(key, 0, -1);
      const list = parseRedisList(raw);
      const dup = this._findDuplicate(list, entry.content);
      if (dup) {
        dup.lastAccessedAt = new Date().toISOString();
        dup.accessCount = (dup.accessCount || 0) + 1;
        if (!dup.embedding && entry.embedding) dup.embedding = entry.embedding;
        console.log(`[Memory] 去重: "${entry.content.slice(0, 30)}..." 合并到已有记忆 ${dup.id}`);
        await replaceList(key, list);
        return dup;
      }

      list.push(entry);
      while (list.length > MAX_LONG_TERM) {
        const removed = list.shift();
        if (removed) console.log(`[Memory] 超出上限，移除: ${removed.id}`);
      }
      await replaceList(key, list);
      return entry;
    });
  }

  /**
   * 获取长期记忆（混合检索：语义 + 关键词）
   */
  async get(userId, query = '') {
    const key = `memory:${userId}:long_term`;
    const raw = await store.lrange(key, 0, -1);
    const list = parseRedisList(raw);

    if (!query || list.length === 0) return list;

    // 关键词打分
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);

    // 语义打分（异步）
    const queryEmbedding = this.embedder.isAvailable
      ? (await this.embedder.embedHybrid(query).catch(() => null))?.dense || null
      : null;

    // 为没有 embedding 的记忆条目计算（懒加载）
    const missingEmbeddings = queryEmbedding ? list.filter(m => !m.embedding) : [];
    if (missingEmbeddings.length > 0) {
      await Promise.all(
        missingEmbeddings.map(m => this._computeEmbedding(m).catch(() => {}))
      );
    }

    // 混合评分
    const scored = list.map(m => {
      let score = 0;

      // 关键词匹配
      if (queryWords.length > 0) {
        const contentLower = (m.content || '').toLowerCase();
        const matchCount = queryWords.filter(w => contentLower.includes(w)).length;
        score += (matchCount / queryWords.length) * KEYWORD_BOOST;
      }

      // 语义相似度
      if (queryEmbedding && m.embedding) {
        const sim = EmbeddingService.cosineSimilarity(queryEmbedding, m.embedding);
        score += sim * (1 - KEYWORD_BOOST);
      }

      // 访问频率加分
      score += Math.min(m.accessCount || 0, 10) * 0.01;

      return { ...m, _score: score };
    });

    // 更新访问统计（异步）
    scored.filter(m => m._score > 0.1).forEach(m => {
      m.accessCount = (m.accessCount || 0) + 1;
      m.lastAccessedAt = new Date().toISOString();
    });
    const accessed = scored.some(m => m._score > 0.1);
    if (missingEmbeddings.length > 0 || accessed) {
      const updates = new Map(scored.map(({ _score, ...memory }) => [memory.id, memory]));
      await withMemoryLock(key, async () => {
        const latestRaw = await store.lrange(key, 0, -1);
        const latest = parseRedisList(latestRaw);
        const merged = latest.map(memory => updates.get(memory.id) || memory);
        await replaceList(key, merged);
      });
    }

    return scored.sort((a, b) => b._score - a._score);
  }

  /**
   * 查找语义重复的记忆
   */
  _findDuplicate(list, content) {
    if (!content || list.length === 0) return null;

    const contentLower = content.toLowerCase();

    // 先精确匹配
    const exact = list.find(m => m.content && m.content.toLowerCase() === contentLower);
    if (exact) return exact;

    // 再找高度重叠的
    for (const m of list) {
      if (!m.content) continue;
      const mContent = m.content.toLowerCase();
      if (mContent.includes(contentLower) || contentLower.includes(mContent)) {
        if (Math.abs(mContent.length - contentLower.length) < contentLower.length * 0.5) {
          return m;
        }
      }
    }

    return null;
  }

  /**
   * 异步计算并存入 embedding
   */
  async _computeEmbedding(entry) {
    if (!this.embedder.isAvailable || !entry.content) return;
    try {
      const result = await this.embedder.embedHybrid(entry.content);
      entry.embedding = result?.dense || null;
    } catch (err) {
      console.warn(`[Memory] embedding 计算失败: ${err.message}`);
    }
  }

  async remove(userId, memoryId) {
    const key = `memory:${userId}:long_term`;
    await withMemoryLock(key, async () => {
      const raw = await store.lrange(key, 0, -1);
      const list = parseRedisList(raw);
      await replaceList(key, list.filter(m => m && m.id !== memoryId));
    });
  }

  async clear(userId) {
    await store.del(`memory:${userId}:long_term`);
  }
}

module.exports = { LongTermMemory, withMemoryLock };
