"use strict";

const { redis: store } = require('../memory-store');
const { EmbeddingService } = require('../embedding.service');
const { parseRedisList } = require('./helpers');

const MAX_LONG_TERM = 100;
const SEMANTIC_SIMILARITY_THRESHOLD = 0.85;
const KEYWORD_BOOST = 0.3;

class LongTermMemory {
  constructor() {
    this.embedder = new EmbeddingService();
  }

  /**
   * 添加长期记忆（自动计算 embedding + 去重）
   */
  async add(userId, memory) {
    const key = `memory:${userId}:long_term`;
    const raw = await store.lrange(key, 0, -1);
    const list = parseRedisList(raw);

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

    // 去重：检查是否已有语义相似的内容
    const dup = this._findDuplicate(list, entry.content);
    if (dup) {
      dup.lastAccessedAt = new Date().toISOString();
      dup.accessCount += 1;
      console.log(`[Memory] 去重: "${entry.content.slice(0, 30)}..." 合并到已有记忆 ${dup.id}`);
    } else {
      list.push(entry);

      // 异步计算 embedding（不阻塞写入）
      this._computeEmbedding(entry).catch(() => {});

      // 限制总数
      while (list.length > MAX_LONG_TERM) {
        const removed = list.shift();
        if (removed) console.log(`[Memory] 超出上限，移除: ${removed.id}`);
      }
    }

    await store.del(key);
    await store.rpush(key, JSON.stringify(list));
    return entry;
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
      ? await this.embedder.embed(query).catch(() => null)
      : null;

    // 为没有 embedding 的记忆条目计算（懒加载）
    if (queryEmbedding) {
      await Promise.all(
        list.filter(m => !m.embedding).map(m => this._computeEmbedding(m).catch(() => {}))
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
    if (scored.some(m => m._score > 0.1)) {
      await store.del(key);
      await store.rpush(key, JSON.stringify(scored.map(({ _score, ...m }) => m)));
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
      entry.embedding = await this.embedder.embed(entry.content);
    } catch (err) {
      console.warn(`[Memory] embedding 计算失败: ${err.message}`);
    }
  }

  async remove(userId, memoryId) {
    const key = `memory:${userId}:long_term`;
    const raw = await store.lrange(key, 0, -1);
    const list = parseRedisList(raw);

    const filtered = list.filter(m => m && m.id !== memoryId);
    await store.del(key);
    await store.rpush(key, JSON.stringify(filtered));
  }

  async clear(userId) {
    await store.del(`memory:${userId}:long_term`);
  }
}

module.exports = { LongTermMemory };
