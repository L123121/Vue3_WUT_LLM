"use strict";

const path = require('path');
const crypto = require('crypto');
const config = require('../config');

const DEFAULT_DENSE_DIM = 512;   // BGE-small-zh 输出 512 维
const DEFAULT_SPARSE_DIM = 250002;
const DEFAULT_MODEL = 'Xenova/bge-small-zh-v1.5';
const DEFAULT_CACHE_DIR = path.resolve(__dirname, '../../../.model-cache');
const EMBED_CACHE_MAX = 2000;    // 向量缓存上限，防止无限增长

/**
 * BGE-small-zh Embedding 服务
 *
 * 本地 BGE-small-zh (ONNX) 作为唯一 embedding 模型，确保入库和查询使用同一语义空间。
 * 模型不可用时自动降级到 n-gram fallback。
 */
class EmbeddingService {
  constructor() {
    this.model = config.embedding.model || DEFAULT_MODEL;
    this.cacheDir = config.embedding.cacheDir || DEFAULT_CACHE_DIR;
    this.localFilesOnly = config.embedding.localFilesOnly !== false;
    this.sparseDim = config.embedding.sparseDim || DEFAULT_SPARSE_DIM;
    this._cache = new Map();
    this._localModel = null;      // 本地 ONNX BGE 模型实例
    this._modelLoading = null;    // 加载中的 promise（防重复加载）
  }

  /**
   * 懒加载本地 BGE ONNX 模型
   */
  async _ensureLocalModel() {
    if (this._localModel) return this._localModel;
    if (this._modelLoading) return this._modelLoading;

    this._modelLoading = (async () => {
      try {
        const { env, pipeline } = require('@huggingface/transformers');
        env.cacheDir = this.cacheDir;
        env.localModelPath = this.cacheDir;   // local_files_only 时从该目录找模型
        env.allowLocalModels = true;
        env.allowRemoteModels = !this.localFilesOnly;

        const extractor = await pipeline('feature-extraction', this.model, {
          dtype: 'q8',
          cache_dir: this.cacheDir,
          local_files_only: this.localFilesOnly,
        });
        console.log(`[Embedding] 本地 BGE-small-zh 模型加载完成: ${this.model} (${DEFAULT_DENSE_DIM}-dim)`);
        this._localModel = extractor;
        return extractor;
      } catch (err) {
        console.warn(`[Embedding] 本地模型加载失败: ${err.message}`);
        this._localModel = null;
        return null;
      }
    })();

    return this._modelLoading;
  }

  /**
   * 使用本地 BGE-small-zh 生成 dense + sparse 混合向量
   */
  async embedHybrid(text) {
    if (!text || !String(text).trim()) return null;

    const cacheKey = this._cacheKey(text);
    if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);

    const localResult = await this._localHybridEmbed(text);
    this._cacheSet(cacheKey, localResult);
    return localResult;
  }

  /**
   * 批量 embedding：优先本地 BGE 模型，其次 n-gram fallback
   */
  async embedBatch(texts) {
    if (!Array.isArray(texts) || texts.length === 0) return [];

    const results = new Array(texts.length).fill(null);
    const pending = [];

    texts.forEach((text, index) => {
      if (!text || !String(text).trim()) return;
      const cacheKey = this._cacheKey(text);
      if (this._cache.has(cacheKey)) {
        results[index] = this._cache.get(cacheKey);
      } else {
        pending.push({ text, index, cacheKey });
      }
    });

    if (pending.length === 0) return results;

    // 批量走本地 BGE 模型
    for (const item of pending) {
      const embedding = await this._localHybridEmbed(item.text);
      this._cacheSet(item.cacheKey, embedding);
      results[item.index] = embedding;
    }

    return results;
  }

  /**
   * 本地 BGE-small-zh dense + n-gram sparse 混合向量
   */
  async _localHybridEmbed(text) {
    const dense = await this._localDense(text);
    return {
      dense,
      sparse: this._localSparse(text),
      model: 'BGE-small-zh:local-onnx',
      dimensions: dense.length,
    };
  }

  /**
   * 本地 BGE-small-zh 生成 dense 向量（512 维）
   */
  async _localDense(text) {
    if (!text) return new Array(DEFAULT_DENSE_DIM).fill(0);

    try {
      const model = await this._ensureLocalModel();
      if (model) {
        const result = await model(text, { pooling: 'cls', normalize: true });
        return Array.from(result.data);
      }
    } catch (err) {
      console.warn(`[Embedding] BGE 推理失败，降级 n-gram: ${err.message}`);
    }

    // n-gram fallback
    return this._fallbackDense(text);
  }

  /**
   * n-gram 哈希 dense（512 维）——仅作为 fallback
   */
  _fallbackDense(text) {
    const normalized = String(text).toLowerCase().trim();
    const vec = new Float64Array(DEFAULT_DENSE_DIM);

    for (let i = 0; i < normalized.length - 1; i++) {
      const hash = this._hashStr(normalized.substring(i, i + 2)) % DEFAULT_DENSE_DIM;
      vec[hash] += 1;
    }
    for (let i = 0; i < normalized.length - 2; i++) {
      const hash = this._hashStr(normalized.substring(i, i + 3)) % DEFAULT_DENSE_DIM;
      vec[hash] += 1.5;
    }
    for (const ch of normalized) {
      const hash = this._hashStr(ch) % DEFAULT_DENSE_DIM;
      vec[hash] += 0.5;
    }

    // L2 归一化
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < vec.length; i++) vec[i] /= norm;

    return Array.from(vec);
  }

  /**
   * n-gram 词项权重 sparse 向量（BM25 风格）
   */
  _localSparse(text) {
    const normalized = String(text || '').toLowerCase().trim();
    const tokens = {};
    const stopWords = new Set(['的', '了', '是', '在', '和', '与', '及', '有', '也', '都', '这', '那', '个', '就', '而', '但', '或', '被', '把', '对', '从', '以', '到', '让', '为', '所', '得', '着', '过', '吧', '呢', '啊', '吗', '嘛']);

    for (let i = 0; i < normalized.length - 1; i++) {
      const bigram = normalized.substring(i, i + 2);
      if (stopWords.has(bigram)) continue;
      const key = (this._hashStr(`b:${bigram}`) >>> 0) % 0xFFFFFE;
      tokens[key] = (tokens[key] || 0) + 1;
    }

    for (let i = 0; i < normalized.length - 2; i++) {
      const trigram = normalized.substring(i, i + 3);
      const key = (this._hashStr(`t:${trigram}`) >>> 0) % 0xFFFFFE;
      tokens[key] = (tokens[key] || 0) + 1;
    }

    return tokens;
  }

  _cacheKey(text) {
    // 用全文哈希做 key：之前截前 200 字符，两个同前缀长文本会错误命中同一向量
    const digest = crypto.createHash('md5').update(String(text).trim()).digest('hex');
    return `emb:${this.model}:${digest}`;
  }

  /**
   * 写入向量缓存（超过上限时淘汰最旧条目，防止无限增长）
   */
  _cacheSet(key, value) {
    this._cache.set(key, value);
    if (this._cache.size > EMBED_CACHE_MAX) {
      const oldestKey = this._cache.keys().next().value;
      if (oldestKey !== undefined) this._cache.delete(oldestKey);
    }
  }

  _hashStr(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash);
  }

  // ==================== 静态工具方法 ====================

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

  static sparseSimilarity(a, b) {
    if (!a || !b) return 0;
    const entriesA = Object.entries(a);
    if (!entriesA.length) return 0;

    let dot = 0, normA = 0, normB = 0;
    for (const [key, valA] of entriesA) {
      const valB = b[key] || 0;
      dot += valA * valB;
      normA += valA * valA;
    }
    for (const valB of Object.values(b)) {
      normB += valB * valB;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  get isAvailable() {
    return true;
  }
}

module.exports = { EmbeddingService };


