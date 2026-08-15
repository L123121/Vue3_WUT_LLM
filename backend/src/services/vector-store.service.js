"use strict";

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { EmbeddingService } = require('./embedding.service');

const DATA_DIR = path.join(__dirname, '../../data');
const VECTOR_FILE = path.join(DATA_DIR, 'vectors.json');
const EXIT_REGISTRY_KEY = Symbol.for('wut.vector-store.exit-registry');

function registerExitPersistence(instance) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;

  if (!global[EXIT_REGISTRY_KEY]) {
    const instances = new Set();
    const saveAll = () => {
      for (const vectorStore of instances) {
        if (vectorStore._dirty && vectorStore._docs.length > 0) {
          try { vectorStore._saveSync(); } catch { /* 退出阶段忽略 */ }
        }
      }
    };
    process.on('SIGTERM', saveAll);
    process.on('SIGINT', saveAll);
    process.on('exit', saveAll);
    global[EXIT_REGISTRY_KEY] = { instances };
  }

  global[EXIT_REGISTRY_KEY].instances.add(instance);
}

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
    this.rrfK = vectorConfig.rrfK ?? 60;
    // 融合方式：rrf（默认）| weighted（0.6/0.4 加权打分，用于 A/B 对比）
    this.fusionMode = vectorConfig.fusion || 'rrf';

    this._docs = [];
    this._dirty = false;
    this._saveTimer = null;
    this._ready = false;
    this._readyPromise = null;
    this._readyResolve = null;
    this._documentProvider = documentProvider;
    this._embeddingService = new EmbeddingService();
    this._initializing = false;

    // 进程级统一注册退出兜底保存，避免多实例重复添加监听器。
    registerExitPersistence(this);

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

    // 融合方式（config.vectorStore.fusion，RAG_FUSION 环境变量）：
    // - rrf（默认）：稠密/稀疏两通道各自按分数独立排名，score = Σ 1/(k + rank)，
    //   只看排名不看分数量纲，免去跨通道分数校准（原 0.6/0.4 加权方案的痛点）
    // - weighted：0.6·denseCosine + 0.4·sparseCosine（旧方案，用于 A/B 对比）
    const scored = candidates.map(doc => ({
      doc,
      denseScore: doc.dense
        ? EmbeddingService.cosineSimilarity(embedding.dense, doc.dense)
        : 0,
      sparseScore: (embedding.sparse && doc.sparse)
        ? EmbeddingService.sparseSimilarity(embedding.sparse, doc.sparse)
        : 0,
    }));

    let results;
    if (this.fusionMode === 'weighted') {
      // 旧加权融合：0.6/0.4 加权打分（兼容 A/B 对比与历史评测复现）
      const vectorWeight = this.vectorWeight;
      const sparseWeight = this.sparseWeight;
      results = scored.map(({ doc, denseScore, sparseScore }) => {
        const score = vectorWeight * denseScore + sparseWeight * sparseScore;
        const channels = [];
        if (denseScore > 0) channels.push('vector');
        if (sparseScore > 0) channels.push('sparse');
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
          _retrievalChannels: channels.length > 0 ? channels : ['vector', 'sparse'],
        };
      });
    } else {
      // RRF 融合（默认）
      // 每通道独立排名：仅对通道得分 > 0 的项计排名（0 分视为该通道未命中，不参与 RRF）
      const rankChannel = (channelScore) => {
        const ranks = new Map();
        scored
          .filter(item => channelScore(item) > 0)
          .sort((a, b) => channelScore(b) - channelScore(a))
          .forEach((item, index) => ranks.set(item.doc.id, index + 1));
        return ranks;
      };
      const denseRanks = rankChannel(item => item.denseScore);
      const sparseRanks = rankChannel(item => item.sparseScore);

      const k = this.rrfK;
      results = scored.map(({ doc, denseScore, sparseScore }) => {
        const channels = [];
        let rrfScore = 0;
        const denseRank = denseRanks.get(doc.id);
        const sparseRank = sparseRanks.get(doc.id);
        if (denseRank) {
          rrfScore += 1 / (k + denseRank);
          channels.push('vector');
        }
        if (sparseRank) {
          rrfScore += 1 / (k + sparseRank);
          channels.push('sparse');
        }
        return {
          id: doc.id,
          docId: doc.metadata?.docId || '',
          parentId: doc.metadata?.parentId || doc.metadata?.docId || '',
          parentText: doc.metadata?.parentText || '',
          parentIdx: doc.metadata?.parentIdx ?? -1,
          text: doc.document || '',
          score: rrfScore,
          title: doc.metadata?.title || '',
          category: doc.metadata?.category || '',
          chunkIndex: doc.metadata?.chunkIndex ?? -1,
          _vectorScore: denseScore,
          _sparseScore: sparseScore,
          _hybridScore: rrfScore,
          _retrievalChannels: channels.length > 0 ? channels : ['vector', 'sparse'],
        };
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
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

// ==================== 按 backend 分发 ====================
// VECTOR_STORE_BACKEND=qdrant → 使用 Qdrant 独立服务版；
// 其余（file / milvus 遗留配置）→ 保持文件持久化版，行为不变。
const vectorBackend = config.vectorStore?.backend || 'file';
if (vectorBackend === 'qdrant') {
  module.exports = require('./vector-store-qdrant.service');
} else {
  module.exports = { vectorStore: getInstance(), registerDocumentProvider, VectorStoreService, _class: VectorStoreService };
}
