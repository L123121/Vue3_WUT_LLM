"use strict";

const config = require('../config');
const { request } = require('../utils/httpClient');
const { metrics } = require('./metrics.service');

/**
 * Embedding 服务 — 调用讯飞/通义千问 Embedding API
 *
 * 配置来源：
 *   1. config.xunfei.apiKey（优先）
 *   2. config.ai.apiKey（同平台 fallback）
 *
 * API 格式：OpenAI-compatible POST /v2/embeddings
 */
class EmbeddingService {
  constructor() {
    this.apiKey = config.xunfei.apiKey || config.ai.apiKey || '';
    this.host = config.embedding.host || 'maas-api.cn-huabei-1.xf-yun.com';
    this.path = config.embedding.path || '/v2/embeddings';
    this.model = config.embedding.model || 'emb-text-001';
    this.timeout = 15000;
    this._cache = new Map(); // 文本 → embedding 向量缓存
  }

  /**
   * 判断服务是否可用
   */
  get isAvailable() {
    return !!this.apiKey;
  }

  /**
   * 生成单个文本的 embedding 向量
   * @param {string} text - 输入文本
   * @returns {number[]|null} 1536 维向量，失败返回 null
   */
  async embed(text) {
    if (!this.isAvailable) return null;
    if (!text || !text.trim()) return null;

    // 缓存命中
    const cacheKey = text.slice(0, 500);
    if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);

    try {
      const vector = await this._callApi(text);
      if (vector) this._cache.set(cacheKey, vector);
      return vector;
    } catch (err) {
      console.warn(`[Embedding] 调用失败: ${err.message}`);
      return null;
    }
  }

  /**
   * 批量生成 embedding
   * @param {string[]} texts
   * @returns {number[][]} 向量数组，与输入一一对应
   */
  async embedBatch(texts) {
    if (!this.isAvailable) return texts.map(() => null);
    const results = await Promise.all(texts.map(t => this.embed(t)));
    return results;
  }

  /**
   * 计算两个向量的余弦相似度
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number} 0~1 之间的相似度
   */
  static cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  // ==================== 内部方法 ====================

  async _callApi(text) {
    const payload = JSON.stringify({
      model: this.model,
      input: text.slice(0, 8000), // 限制长度
    });

    const host = this.host.replace(/^https?:\/\//, '');
    const options = {
      hostname: host,
      path: this.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Length': Buffer.byteLength(payload, 'utf8'),
      },
      timeout: this.timeout,
    };

    const result = await request(options, payload);
    metrics.recordLatency('embedding', Date.now() - Date.now());

    const vector = result.data?.data?.[0]?.embedding;
    if (vector && Array.isArray(vector)) {
      return vector;
    }
    throw new Error('响应中无 embedding 数据');
  }
}

module.exports = { EmbeddingService };
