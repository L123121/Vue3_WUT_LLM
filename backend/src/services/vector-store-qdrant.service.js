"use strict";

const config = require('../config');

const DEFAULT_COLLECTION = 'wuli_elf_chunks';
const DENSE_DIM = 512;
// Qdrant(actix-web) 默认单请求体上限 ~2MB：长 parentText 下 128 条/批会超限被断连(EPIPE)，
// 减小批量 + 失败重试，保证大文档重建稳定
const BATCH_SIZE = 32;
const UPSERT_MAX_RETRY = 3;

/**
 * QdrantVectorStore — Qdrant 独立服务向量库（单例）
 *
 * 与 vector-store.service.js（文件持久化版）保持完全一致的外部接口：
 *   addChunks / search / deleteByDocId / resetCollection / count / isAvailable / ensureReady / setDocumentProvider
 *
 * 设计：
 *   - collection 命名向量：dense(512d, Cosine) + sparse(idf modifier)
 *   - payload 存全量元数据：docId / parentId / parentIdx / parentText / title / category / chunkIndex / text
 *   - point id：原始字符串 id（docId_sent_i）确定性哈希为 uint32，冲突时线性探测
 *   - search：dense + sparse 两次查询，客户端按 weights 加权融合（与文件版评分语义一致）
 *   - 评分：score = vectorWeight·denseCosine + sparseWeight·sparseDot，附带 _vectorScore/_sparseScore/_hybridScore
 */
class QdrantVectorStore {
  constructor(documentProvider = null) {
    const vectorConfig = config.vectorStore || {};
    this.vectorWeight = vectorConfig.vectorWeight ?? 0.6;
    this.sparseWeight = vectorConfig.sparseWeight ?? 0.4;
    this.url = vectorConfig.qdrantUrl || 'http://localhost:6333';
    this.apiKey = vectorConfig.qdrantApiKey || '';
    this.collectionName = vectorConfig.collectionName || DEFAULT_COLLECTION;

    this._client = null;
    this._ready = false;
    this._readyPromise = null;
    this._readyResolve = null;
    this._readyChecked = false; // ensureReady 是否已完成空库检查/重建
    this._documentProvider = documentProvider;
    this._initializing = false;
    this._pointCount = 0;
    this._idMap = new Map(); // hash → originalId，用于碰撞探测
    this._dirty = false;      // 兼容 app.js 优雅关闭检查（Qdrant 无本地脏标记）

    this._connect();
  }

  setDocumentProvider(provider) {
    if (typeof provider === 'function') this._documentProvider = provider;
  }

  // ==================== 初始化 ====================

  /** 创建 Qdrant 客户端（独立方法便于测试注入 fake） */
  _createClient() {
    const { QdrantClient } = require('@qdrant/js-client-rest');
    return new QdrantClient({
      url: this.url,
      apiKey: this.apiKey || undefined,
      timeout: 15000,
      // 客户端(1.19)与服务端(如 1.12)小版本差异超 1 时仅提示不阻断；
      // 本服务只使用基础 REST API（collection/upsert/query/count/delete），跨小版本兼容
      checkCompatibility: false,
    });
  }

  async _connect() {
    try {
      this._client = this._createClient();
      const { exists } = await this._client.collectionExists(this.collectionName);
      if (!exists) {
        await this._client.createCollection(this.collectionName, {
          vectors: {
            dense: { size: DENSE_DIM, distance: 'Cosine', on_disk: false },
          },
          sparse_vectors: {
            sparse: { modifier: 'idf' },
          },
        });
        console.log(`[QdrantStore] 已创建 collection: ${this.collectionName} (dense ${DENSE_DIM}d + sparse)`);
      } else {
        console.log(`[QdrantStore] 已连接 collection: ${this.collectionName}`);
      }
      const count = await this._client.count(this.collectionName, { exact: true });
      this._pointCount = count.count || 0;
      this._ready = true;
      if (this._readyResolve) this._readyResolve();
      console.log(`[QdrantStore] 就绪，当前 ${this._pointCount} 条向量`);
    } catch (err) {
      console.warn(`[QdrantStore] 连接失败（后续 search 将返回空，可重试）: ${err.message}`);
      this._ready = true;
      if (this._readyResolve) this._readyResolve();
    }
  }

  /** 仅等待连接就绪（不触发重建）。内部写/查操作使用，避免与 ensureReady 的重建流程互相等待 */
  async _waitConnected() {
    while (!this._ready) {
      await new Promise(r => setTimeout(r, 100));
    }
    return this._client;
  }

  async ensureReady() {
    // 已就绪且已完成空库检查 → 直接返回
    if (this._ready && this._readyChecked) return;
    if (this._readyPromise) return this._readyPromise;

    this._readyPromise = (async () => {
      // 等待构造函数里异步发起的 _connect 完成
      await this._waitConnected();
      if (!this._client) return; // 连接失败，search 会返回空
      // collection 为空且有文档提供者 → 从文档库重建索引
      if (this._pointCount === 0) {
        await this._rebuildFromDocuments();
      }
      this._readyChecked = true;
    })();

    try {
      await this._readyPromise;
    } catch (err) {
      console.warn(`[QdrantStore] ensureReady 失败: ${err.message}`);
      this._readyChecked = true;
    }
    return this._readyPromise;
  }

  async _rebuildFromDocuments() {
    if (!this._documentProvider) return;
    if (this._initializing) return;
    this._initializing = true;
    try {
      const docs = await this._documentProvider();
      if (!Array.isArray(docs) || docs.length === 0) {
        console.log('[QdrantStore] 文档库为空，跳过重建');
        return;
      }
      console.log(`[QdrantStore] collection 为空，从 ${docs.length} 个文档重建索引...`);
      const t0 = Date.now();
      const { IndexingService } = require('./indexing.service');
      const { EmbeddingService } = require('./embedding.service');
      const indexing = new IndexingService(this, new EmbeddingService());
      await indexing.reindexAll(docs);
      console.log(`[QdrantStore] 重建完成，共 ${this._pointCount} 条向量，耗时 ${Date.now() - t0} ms`);
    } catch (err) {
      console.warn(`[QdrantStore] 重建失败: ${err.message}`);
      if (err.cause) {
        const causeMsg = err.cause.message || (typeof err.cause === 'string' ? err.cause : JSON.stringify(err.cause).slice(0, 300));
        console.warn(`[QdrantStore] 重建失败 cause: ${causeMsg}`);
      }
      if (err.stack) {
        console.warn('[QdrantStore] 重建失败 stack:\n' + err.stack.split('\n').slice(0, 8).join('\n'));
      }
    } finally {
      this._initializing = false;
    }
  }

  // ==================== 公开 API ====================

  async addChunks(ids, embeddings, documents, metadatas) {
    if (!ids.length) return;
    // 内部写操作只等连接就绪（不触发/等待重建），避免 reindexAll 期间与外层 ensureReady 互相等待
    await this._waitConnected();
    if (!this._client) throw new Error('Qdrant not initialized');

    const points = [];
    for (let i = 0; i < ids.length; i++) {
      const metadata = metadatas[i] || {};
      const embedding = this._normalizeEmbedding(embeddings[i]);
      if (!embedding?.dense?.length) continue;

      const pointId = this._toPointId(ids[i]);
      points.push({
        id: pointId,
        vector: {
          dense: embedding.dense,
          sparse: this._toSparseVector(embedding.sparse),
        },
        payload: {
          id: ids[i],
          text: documents[i] || '',
          docId: metadata.docId || '',
          parentId: metadata.parentId || metadata.docId || '',
          parentIdx: metadata.parentIdx ?? -1,
          parentText: metadata.parentText || '',
          title: metadata.title || '',
          category: metadata.category || '',
          chunkIndex: metadata.chunkIndex ?? -1,
        },
      });
    }

    for (let i = 0; i < points.length; i += BATCH_SIZE) {
      const batch = points.slice(i, i + BATCH_SIZE);
      // 大文档重建时可能偶发瞬时断连(EPIPE/超时)，重试提高稳定性
      for (let attempt = 1; attempt <= UPSERT_MAX_RETRY; attempt++) {
        try {
          await this._client.upsert(this.collectionName, { points: batch });
          break;
        } catch (err) {
          if (attempt === UPSERT_MAX_RETRY) throw err;
          console.warn(`[QdrantStore] upsert 批次 ${i / BATCH_SIZE + 1} 第 ${attempt} 次失败(${err.message})，重试...`);
          await new Promise(r => setTimeout(r, 300 * attempt));
        }
      }
    }
    this._pointCount += points.length;
    this._dirty = true;
  }

  async search(queryEmbedding, topK = 10, filter = null, weights = null) {
    await this._waitConnected();
    if (!this._client) return [];

    const embedding = this._normalizeEmbedding(queryEmbedding);
    if (!embedding?.dense?.length) return [];

    const vectorWeight = weights?.vector ?? this.vectorWeight;
    const sparseWeight = weights?.sparse ?? this.sparseWeight;
    const qdrantFilter = this._buildFilter(filter);

    // dense + sparse 并行查询（RAG 首包延迟关键路径）
    const [denseRes, sparseRes] = await Promise.all([
      // dense 查询（Cosine，score 即余弦相似度）
      this._client.query(this.collectionName, {
        query: embedding.dense,
        using: 'dense',
        limit: topK,
        filter: qdrantFilter,
        with_payload: true,
      }),
      // sparse 查询（dot + idf modifier）
      (async () => {
        const sparseVector = this._toSparseVector(embedding.sparse);
        if (sparseVector.indices.length === 0) return { points: [] };
        return this._client.query(this.collectionName, {
          query: sparseVector,
          using: 'sparse',
          limit: topK,
          filter: qdrantFilter,
          with_payload: true,
        });
      })(),
    ]);

    // 客户端融合：按原始 id 合并，score = w·dense + (1-w)·sparse
    const merged = new Map();
    const add = (point, denseScore, sparseScore) => {
      const id = point.payload?.id || point.id;
      const existing = merged.get(id) || {
        id,
        docId: point.payload?.docId || '',
        parentId: point.payload?.parentId || point.payload?.docId || '',
        parentText: point.payload?.parentText || '',
        parentIdx: point.payload?.parentIdx ?? -1,
        text: point.payload?.text || '',
        title: point.payload?.title || '',
        category: point.payload?.category || '',
        chunkIndex: point.payload?.chunkIndex ?? -1,
        _vectorScore: 0,
        _sparseScore: 0,
        _retrievalChannels: [],
      };
      existing._vectorScore = Math.max(existing._vectorScore, denseScore);
      existing._sparseScore = Math.max(existing._sparseScore, sparseScore);
      if (denseScore > 0 && !existing._retrievalChannels.includes('vector')) existing._retrievalChannels.push('vector');
      if (sparseScore > 0 && !existing._retrievalChannels.includes('sparse')) existing._retrievalChannels.push('sparse');
      merged.set(id, existing);
    };

    for (const p of denseRes.points || []) add(p, p.score || 0, 0);
    for (const p of sparseRes.points || []) add(p, 0, p.score || 0);

    const scored = [...merged.values()].map(item => {
      const score = vectorWeight * item._vectorScore + sparseWeight * item._sparseScore;
      return { ...item, score, _hybridScore: score, _retrievalChannels: item._retrievalChannels.length ? item._retrievalChannels : ['vector', 'sparse'] };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async deleteByDocId(docId) {
    if (!this._client) return;
    await this._waitConnected();
    const result = await this._client.delete(this.collectionName, {
      filter: { must: [{ key: 'docId', match: { value: docId } }] },
    });
    if (result?.status === 'completed') this._pointCount = 0; // 懒刷新，下次 count 修正
  }

  async resetCollection() {
    if (!this._client) return;
    try {
      await this._client.deleteCollection(this.collectionName);
      console.log(`[QdrantStore] 已删除 collection: ${this.collectionName}`);
    } catch (err) {
      console.warn(`[QdrantStore] 删除 collection 失败: ${err.message}`);
    }
    this._pointCount = 0;
    this._idMap.clear();
    this._ready = false;
    this._client = null;
    await this._connect();
  }

  async count() {
    if (!this._client) return 0;
    try {
      const result = await this._client.count(this.collectionName, { exact: true });
      this._pointCount = result.count || 0;
      return this._pointCount;
    } catch {
      return this._pointCount;
    }
  }

  async isAvailable() {
    return !!this._client;
  }

  // ==================== 兼容字段（app.js 使用） ====================

  /** app.js 打印 `vectorStore._docs.length` —— 返回带 length 的轻量对象 */
  get _docs() {
    return { length: this._pointCount };
  }

  /** app.js 优雅关闭时调用 —— Qdrant 无本地脏标记，no-op */
  _saveSync() {}

  // ==================== 工具 ====================

  _toPointId(originalId) {
    const hash = this._hashString(String(originalId));
    let pointId = hash;
    // 线性探测避免哈希碰撞
    while (this._idMap.has(pointId) && this._idMap.get(pointId) !== originalId) {
      pointId = (pointId + 1) >>> 0;
    }
    this._idMap.set(pointId, originalId);
    return pointId;
  }

  _hashString(str) {
    let hash = 2166136261; // FNV-1a 32bit
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  _toSparseVector(sparse) {
    if (!sparse || typeof sparse !== 'object') return { indices: [], values: [] };
    const entries = Object.entries(sparse).filter(([, v]) => v > 0);
    entries.sort((a, b) => Number(a[0]) - Number(b[0]));
    return {
      indices: entries.map(([k]) => Number(k)),
      values: entries.map(([, v]) => v),
    };
  }

  _buildFilter(filter) {
    if (!filter || typeof filter !== 'object') return undefined;
    const must = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null || value === '') continue;
      const payloadKey = key === 'docId' ? 'docId' : key;
      must.push({ key: payloadKey, match: { value } });
    }
    return must.length ? { must } : undefined;
  }

  _normalizeEmbedding(embedding) {
    if (!embedding) return null;
    if (Array.isArray(embedding)) return { dense: embedding, sparse: {} };
    if (Array.isArray(embedding.dense)) {
      return { dense: embedding.dense, sparse: embedding.sparse || {} };
    }
    if (Array.isArray(embedding.embedding)) {
      return {
        dense: embedding.embedding,
        sparse: embedding.sparse || embedding.sparse_vector || {},
      };
    }
    return null;
  }
}

// ==================== 单例 ====================

let instance = null;
function getInstance() {
  if (!instance) instance = new QdrantVectorStore();
  return instance;
}
function registerDocumentProvider(provider) {
  getInstance().setDocumentProvider(provider);
}

module.exports = { vectorStore: getInstance(), registerDocumentProvider, QdrantVectorStore, _class: QdrantVectorStore };
