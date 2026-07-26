"use strict";

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { EmbeddingService } = require('./embedding.service');

const DATA_DIR = path.join(__dirname, '../../data');
const VECTOR_FILE = path.join(DATA_DIR, 'vectors.json');

/**
 * VectorStoreService — 文件持久化 + 暴力精确余弦相似度
 *
 * 适用场景：chunk 数量 < 50000（校园知识库通常几百~几千条）
 * 精度：精确计算，无 ANN 近似误差
 * 持久化：JSON 文件，容器重启不丢数据
 */
class VectorStoreService {
  constructor() {
    const vectorConfig = config.vectorStore || {};
    this.vectorWeight = vectorConfig.vectorWeight ?? 0.6;
    this.sparseWeight = vectorConfig.sparseWeight ?? 0.4;

    this._docs = [];
    this._dirty = false;
    this._saveTimer = null;
    this._load();
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
        metadata: {
          ...metadata,
          parentId: metadata.parentId || metadata.docId,
        },
      });
    }

    this._scheduleSave();
  }

  async search(queryEmbedding, topK = 10, filter = null) {
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
      if (fs.existsSync(VECTOR_FILE)) {
        const raw = fs.readFileSync(VECTOR_FILE, 'utf-8');
        const data = JSON.parse(raw);
        this._docs = Array.isArray(data) ? data : [];
        console.log(`[VectorStore] 已加载 ${this._docs.length} 条向量（文件持久化）`);
      } else {
        console.log('[VectorStore] 向量文件不存在，从空库启动');
      }
    } catch (err) {
      console.warn(`[VectorStore] 加载向量文件失败，从空库启动: ${err.message}`);
      this._docs = [];
    }
  }

  _scheduleSave() {
    this._dirty = true;
    if (this._saveTimer) return;
    // 防抖 2 秒，批量写入时不频繁 IO
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

module.exports = { VectorStoreService };
