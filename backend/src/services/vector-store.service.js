"use strict";

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { EmbeddingService } = require('./embedding.service');

const DATA_DIR = path.join(__dirname, '../../data');
const VECTOR_FILE = path.join(DATA_DIR, 'vectors.json');

/**
 * VectorStoreService — 文件持久化 + 精确相似度检索（单例）
 *
 * 适用场景：chunk 数量 < 50000（校园知识库通常几百~几千条）
 * 精度：精确计算，无 ANN 近似误差
 * 持久化：JSON 文件，容器重启后从文件恢复（或从文档库自动重建）
 *
 * 初始化流程（异步，幂等）：
 *   1. 从 vectors.json 加载已有向量
 *   2. 若文件不存在 → 从注入的 documentProvider 重建索引
 *   3. 重建完成后标记 ready，后续 search 请求正常处理
 *
 * 使用方式：
 *   const { vectorStore, registerDocumentProvider } = require('./vector-store.service');
 *   registerDocumentProvider(async () => [...文档列表...]);
 *   await vectorStore.ensureReady();
 */
class VectorStoreService {
  constructor(documentProvider = null) {
    const vectorConfig = config.vectorStore || {};
    this.vectorWeight = vectorConfig.vectorWeight ?? 0.6;
    this.sparseWeight = vectorConfig.sparseWeight ?? 0.4;

    this._docs = [];
    this._dirty = false;
    this._saveTimer = null;
    this._ready = false;
    this._readyPromise = null;
    this._readyResolve = null;
    this._documentProvider = documentProvider;
    this._embeddingService = new EmbeddingService();
    this._initializing = false;

    // 注册退出兜底保存（容器 stop / kill 时尽量不丢数据）
    this._exitHandler = () => {
      if (this._dirty && this._docs.length > 0) {
        try { this._saveSync(); } catch (_) { /* 退出阶段忽略 */ }
      }
    };
    process.on('SIGTERM', this._exitHandler);
    process.on('SIGINT', this._exitHandler);
    process.on('exit', this._exitHandler);

    this._load();
  }

  /** 供 DocumentService 注册文档提供者（延迟注入，打破循环依赖） */
  setDocumentProvider(provider) {
    if (typeof provider === 'function') this._documentProvider = provider;
  }

  /**
   * 确保向量库就绪（加载文件或从文档重建）。
   * 幂等：多次调用共享同一个 promise，不会重复重建。
   */
  async ensureReady() {
    if (this._ready) return;
    if (this._readyPromise) return this._readyPromise;

    this._readyPromise = (async () => {
      if (this._docs.length > 0) {
        this._markReady();
        return;
      }
      await this._rebuildFromDocuments();
      this._markReady();
    })();

    try {
      await this._readyPromise;
    } catch (err) {
      console.error(`[VectorStore] 初始化失败: ${err.message}`);
      this._markReady(); // 失败也标记就绪，避免 search 永远挂起
    }
    return this._readyPromise;
  }

  _markReady() {
    if (this._ready) return;
    this._ready = true;
    if (this._readyResolve) this._readyResolve();
    console.log(`[VectorStore] 就绪，共 ${this._docs.length} 条向量`);
  }

  /** 从文档库重建索引 */
  async _rebuildFromDocuments() {
    if (!this._documentProvider) return;
    if (this._initializing) return;
    this._initializing = true;
    try {
      const docs = await this._documentProvider();
      if (!Array.isArray(docs) || docs.length === 0) {
        console.log('[VectorStore] 文档库为空，跳过重建');
        return;
      }
      console.log(`[VectorStore] 向量文件为空，从 ${docs.length} 个文档重建索引...`);
      const t0 = Date.now();
      const { IndexingService } = require('./indexing.service');
      const indexing = new IndexingService(this, this._embeddingService);
      await indexing.reindexAll(docs);
      console.log(`[VectorStore] 重建完成，共 ${this._docs.length} 条向量，耗时 ${Date.now() - t0} ms`);
    } catch (err) {
      console.warn(`[VectorStore] 重建失败: ${err.message}`);
    } finally {
      this._initializing = false;
    }
  }

  // ==================== 公开 API ====================

  async addChunks(ids, embeddings, documents, metadatas) {
    if (!ids.length) return;
    for (let i = 0; i < ids.length; i++) {
      const metadata = metadatas[i] || {};
      const embedding = this._normalizeEmbedding(embeddings[i]);
      this._docs.push({
        id: ids[i],
        dense: embedding?.dense || null,
        sparse: embedding?.sparse || {},
        document: documents[i],
        metadata: { ...metadata, parentId: metadata.parentId || metadata.docId },
      });
    }
    this._scheduleSave();
  }

  async search(queryEmbedding, topK = 10, filter = null) {
    if (!this._ready) await this.ensureReady();

    const embedding = this._normalizeEmbedding(queryEmbedding);
    if (!embedding?.dense?.length) return [];

    let candidates = this._docs;
    if (filter) {
      candidates = candidates.filter(doc =>
        Object.entries(filter).every(([key, value]) => doc.metadata?.[key] === value)
      );
    }

    const scored = candidates.map(doc => {
      const denseScore = doc.dense
        ? EmbeddingService.cosineSimilarity(embedding.dense, doc.dense)
        : 0;
      const sparseScore = (embedding.sparse && doc.sparse)
        ? EmbeddingService.sparseSimilarity(embedding.sparse, doc.sparse)
        : 0;
      const score = this.vectorWeight * denseScore + this.sparseWeight * sparseScore;
      return {
        id: doc.id,
        docId: doc.metadata?.docId || '',
        parentId: doc.metadata?.parentId || doc.metadata?.docId || '',
        parentText: doc.metadata?.parentText || '',
        parentIdx: doc.metadata?.parentIdx ?? -1,
        text: doc.document || '',
        score,
        title: doc.metadata?.title || '',
        category: doc.metadata?.category || '',
        chunkIndex: doc.metadata?.chunkIndex ?? -1,
        _vectorScore: denseScore,
        _sparseScore: sparseScore,
        _hybridScore: score,
        _retrievalChannels: ['vector', 'sparse'],
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async deleteByDocId(docId) {
    const before = this._docs.length;
    this._docs = this._docs.filter(d =>
      d.metadata?.docId !== docId && d.metadata?.parentId !== docId
    );
    if (this._docs.length !== before) this._scheduleSave();
  }

  async resetCollection() {
    this._docs = [];
    this._saveSync();
    console.log('[VectorStore] 已重置向量库');
  }

  async count() {
    return this._docs.length;
  }

  async isAvailable() {
    return true;
  }

  // ==================== 持久化 ====================

  _load() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      if (fs.existsSync(VECTOR_FILE)) {
        const raw = fs.readFileSync(VECTOR_FILE, 'utf-8');
        const data = JSON.parse(raw);
        this._docs = Array.isArray(data) ? data : [];
        console.log(`[VectorStore] 已加载 ${this._docs.length} 条向量（文件持久化）`);
      } else {
        console.log('[VectorStore] 向量文件不存在，将从文档库重建（若可用）');
      }
    } catch (err) {
      console.warn(`[VectorStore] 加载向量文件失败，从空库启动: ${err.message}`);
      this._docs = [];
    }
  }

  _scheduleSave() {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._saveSync();
    }, 2000);
  }

  _saveSync() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = VECTOR_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this._docs));
      fs.renameSync(tmp, VECTOR_FILE);
      this._dirty = false;
    } catch (err) {
      console.error(`[VectorStore] 保存向量文件失败: ${err.message}`);
    }
  }

  // ==================== 工具 ====================

  _readyResolvable() {
    if (this._ready) return Promise.resolve();
    return new Promise(resolve => { this._readyResolve = resolve; });
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
  if (!instance) instance = new VectorStoreService();
  return instance;
}
function registerDocumentProvider(provider) {
  getInstance().setDocumentProvider(provider);
}

module.exports = { vectorStore: getInstance(), registerDocumentProvider, VectorStoreService, _class: VectorStoreService };
