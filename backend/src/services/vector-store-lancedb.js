"use strict";

// ============================================================
// LanceDBVectorStore — LanceDB 嵌入式向量数据库
// 替换原 JSON 文件方案，支持标量过滤 + 增量写入 + 自动索引
// 外部接口保持不变（addChunks / search / deleteByDocId / count / resetCollection）
// ============================================================

const path = require('path');
const config = require('../config');

const DATA_DIR = path.join(__dirname, '../../data');
const LANCE_DIR = path.join(DATA_DIR, 'lancedb');

let instance = null;
let _documentProvider = null;

function registerDocumentProvider(provider) {
  if (typeof provider === 'function') _documentProvider = provider;
}

function getInstance() {
  if (!instance) instance = new LanceDBVectorStore();
  return instance;
}

class LanceDBVectorStore {
  constructor() {
    const vectorConfig = config.vectorStore || {};
    this.vectorWeight = vectorConfig.vectorWeight ?? 0.6;
    this.sparseWeight = vectorConfig.sparseWeight ?? 0.4;

    this._db = null;
    this._table = null;
    this._ready = false;
    this._readyPromise = null;
    this._readyResolve = null;
    this._documentProvider = _documentProvider;
    this._initializing = false;
    this._tableName = (vectorConfig.tableName || 'vectors');

    this._init();
  }

  setDocumentProvider(provider) {
    if (typeof provider === 'function') this._documentProvider = provider;
  }

  async _init() {
    if (this._initializing) return;
    this._initializing = true;

    try {
      const fs = require('fs');
      if (!fs.existsSync(LANCE_DIR)) {
        fs.mkdirSync(LANCE_DIR, { recursive: true });
      }

      const { connect } = require('@lancedb/lancedb');
      this._db = await connect(LANCE_DIR);

      const tableNames = await this._db.tableNames();
      if (tableNames.includes(this._tableName)) {
        this._table = await this._db.openTable(this._tableName);
        console.log('[LanceDB] 已打开表:', this._tableName);
      } else {
        console.log('[LanceDB] 表不存在，等待首次写入创建');
      }

      this._ready = true;
      if (this._readyResolve) this._readyResolve();
    } catch (err) {
      console.error('[LanceDB] 初始化失败:', err.message);
      this._ready = true;
      if (this._readyResolve) this._readyResolve();
    }
  }

  async ensureReady() {
    if (this._ready) return;
    if (this._readyPromise) return this._readyPromise;
    this._readyPromise = new Promise(resolve => {
      this._readyResolve = resolve;
    });
    return this._readyPromise;
  }

  async addChunks(ids, embeddings, documents, metadatas) {
    if (!ids.length) return;
    await this.ensureReady();
    if (!this._db) throw new Error('LanceDB not initialized');

    const dim = embeddings[0].length;
    const rows = ids.map((id, i) => {
      const meta = metadatas[i] || {};
      return {
        id,
        vector: embeddings[i],
        text: documents[i] || '',
        docId: meta.docId || '',
        parentId: meta.parentId || '',
        parentIdx: meta.parentIdx ?? 0,
        parentText: meta.parentText || '',
        docTitle: meta.docTitle || '',
        category: meta.category || '',
        chunkIndex: meta.chunkIndex ?? 0,
        score: meta.score ?? 0,
        timestamp: Date.now(),
      };
    });

    if (this._table) {
      await this._table.add(rows);
    } else {
      this._table = await this._db.createTable(this._tableName, rows);
      console.log('[LanceDB] 创建表:', this._tableName, '维度:', dim);
    }

    const count = await this._table.countRows();
    if (count > 0 && count % 5000 < ids.length) {
      try {
        await this._table.createIndex('vector', {
          config: { num_partitions: 256, num_sub_vectors: Math.min(dim, 96) }
        });
        console.log('[LanceDB] 自动建索引完成, 行数:', count);
      } catch (_) { /* ignore */ }
    }
  }

  async search(queryEmbedding, topK = 10, filter = null, weights = null) {
    await this.ensureReady();
    if (!this._table) return [];

    const embedding = this._normalizeEmbedding(queryEmbedding);

    let query = this._table
      .search(embedding)
      .limit(topK)
      .select(['id', 'text', 'docId', 'parentId', 'parentIdx', 'parentText', 'docTitle', 'category', 'chunkIndex', 'score']);

    if (filter) {
      if (filter.docId) query = query.where(`docId = '${filter.docId}'`);
      if (filter.category) query = query.where(`category = '${filter.category}'`);
    }

    const results = await query.toArray();

    return results.map(r => ({
      id: r.id,
      score: this._computeScore(1 - (r._distance || 0), weights),
      text: r.text,
      metadata: {
        docId: r.docId,
        parentId: r.parentId,
        parentIdx: r.parentIdx,
        parentText: r.parentText,
        docTitle: r.docTitle,
        category: r.category,
        chunkIndex: r.chunkIndex,
      },
      _distance: r._distance,
      _vectorScore: 1 - (r._distance || 0),
    }));
  }

  async deleteByDocId(docId) {
    await this.ensureReady();
    if (!this._table) return;
    await this._table.delete(`docId = '${docId}'`);
  }

  async resetCollection() {
    await this.ensureReady();
    if (!this._db) return;
    try {
      await this._db.dropTable(this._tableName);
      this._table = null;
      console.log('[LanceDB] 已删除表:', this._tableName);
    } catch (_) { /* ignore */ }
  }

  async count() {
    await this.ensureReady();
    if (!this._table) return 0;
    return this._table.countRows();
  }

  async isAvailable() {
    try {
      await this.ensureReady();
      return !!(this._db && this._table);
    } catch (_) {
      return false;
    }
  }

  async rebuildFromDocuments() {
    if (!this._documentProvider) {
      console.log('[LanceDB] 无文档提供者，跳过重建');
      return;
    }

    console.log('[LanceDB] 开始从文档重建索引...');
    await this.resetCollection();

    const { EmbeddingService } = require('./embedding.service');
    const embeddingService = new EmbeddingService();
    const docs = await this._documentProvider();

    if (!docs || !docs.length) {
      console.log('[LanceDB] 无文档需要索引');
      return;
    }

    const { IndexingService } = require('./indexing.service');
    const indexingService = new IndexingService(this, embeddingService);
    let totalChunks = 0;

    for (const doc of docs) {
      const chunks = await indexingService.indexDocument(doc);
      totalChunks += chunks;
    }

    console.log('[LanceDB] 重建完成，共', totalChunks, '个向量');
  }

  _normalizeEmbedding(emb) {
    if (!emb || !emb.length) return [];
    const sum = emb.reduce((s, v) => s + v * v, 0);
    if (sum === 0) return emb.slice();
    const norm = Math.sqrt(sum);
    return emb.map(v => v / norm);
  }

  _computeScore(vectorScore, weights) {
    const w = this.vectorWeight || (weights && weights.vectorWeight) || 0.6;
    return w * vectorScore;
  }
}

module.exports = {
  vectorStore: getInstance(),
  registerDocumentProvider,
  LanceDBVectorStore,
  _class: LanceDBVectorStore,
};
