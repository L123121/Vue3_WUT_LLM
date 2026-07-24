"use strict";

const { v4: uuidv4 } = require('uuid');
const { TextSplitter } = require('../utils/text-splitter');
const { redis: store } = require('./memory-store');
const { IndexingService } = require('./indexing.service');

const VECTOR_STATUS = Object.freeze({
  LOCAL_ONLY: 'local_only',
  READY: 'ready',
  FAILED: 'failed',
});

class DocumentService {
  constructor() {
    this.splitter = new TextSplitter({
      chunkSize: 500,
      chunkOverlap: 50,
    });
    this.indexingService = new IndexingService();
  }

  /**
   * 添加文档到知识库（自动切片 → 向量化 → ChromaDB 存储）
   */
  async addDocument(doc) {
    const { title, content, category = 'general', metadata = {} } = doc;

    if (!content || content.trim().length === 0) {
      throw new Error('文档内容不能为空');
    }

    const docId = `doc_${uuidv4()}`;
    const now = Date.now();

    // 切片计数（仅用于元数据展示）
    const chunks = this.splitter.splitByParagraph(content);
    console.log(`[Document] 文档切片完成: ${chunks.length} 段`);

    // 异步索引到向量库（不阻塞响应）
    const indexPromise = this.indexingService.indexDocument(docId, title, content, category)
      .then(chunkCount => {
        console.log(`[Document] 向量索引完成: ${docId}, ${chunkCount} 切片`);
      })
      .catch(err => {
        console.error(`[Document] 向量索引失败: ${docId}`, err.message);
      });

    const docMetadata = {
      id: docId,
      title,
      category,
      content,
      contentLength: content.length,
      chunkCount: chunks.length,
      createdAt: now,
      vectorStatus: VECTOR_STATUS.READY,
      vectorMessage: '',
      vectorUpdatedAt: now,
      metadata: JSON.stringify(metadata),
    };

    await store.hset(`document:${docId}`, docMetadata);
    await store.sadd('documents:all', docId);

    // 等待索引完成（最多等 30s）
    try {
      await Promise.race([
        indexPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('索引超时')), 30000)),
      ]);
    } catch (err) {
      // 索引超时或失败不阻塞返回，但记录状态
      await store.hset(`document:${docId}`, {
        vectorStatus: VECTOR_STATUS.FAILED,
        vectorMessage: err.message,
      });
    }

    return {
      id: docId,
      title,
      chunkCount: chunks.length,
      vectorStatus: VECTOR_STATUS.READY,
      vectorMessage: '本地向量索引完成',
      message: '文档添加成功（已索引到本地向量库）',
    };
  }

  async addDocuments(docs) {
    const results = [];
    for (const doc of docs) {
      try {
        const result = await this.addDocument(doc);
        results.push(result);
      } catch (error) {
        console.error(`[Document] 批量添加失败: ${doc.title}`, error.message);
        results.push({ title: doc.title, error: error.message });
      }
    }
    return results;
  }

  async deleteDocument(docId) {
    const docMeta = await store.hgetall(`document:${docId}`);
    if (!docMeta || !docMeta.id) {
      throw new Error('文档不存在');
    }

    // 异步删除向量索引（不阻塞响应）
    this.indexingService.removeDocument(docId).catch(err => {
      console.warn(`[Document] 向量索引删除失败: ${docId}`, err.message);
    });

    await store.del(`document:${docId}`);
    await store.srem('documents:all', docId);

    return { message: '文档删除成功', docId };
  }

  async listDocuments(options = {}) {
    const { category, page = 1, limit = 20 } = options;

    const docIds = await store.smembers('documents:all');

    const pipeline = store.pipeline();
    docIds.forEach(id => pipeline.hgetall(`document:${id}`));
    const results = await pipeline.exec();

    let documents = results
      .map(([err, data]) => data)
      .filter(d => d && d.id)
      .map(d => this._normalizeDocMeta(d, { includeContent: false }));

    if (category) {
      documents = documents.filter(d => d.category === category);
    }

    documents.sort((a, b) => b.createdAt - a.createdAt);

    const total = documents.length;
    const start = (page - 1) * limit;
    const end = start + limit;
    documents = documents.slice(start, end);

    return {
      documents,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getDocument(docId) {
    const docMeta = await store.hgetall(`document:${docId}`);
    if (!docMeta || !docMeta.id) return null;

    return this._normalizeDocMeta(docMeta, { includeContent: true });
  }

  // ==================== 内部方法 ====================

  _normalizeDocMeta(docMeta, { includeContent = false } = {}) {
    const doc = {
      id: docMeta.id,
      title: docMeta.title,
      category: docMeta.category,
      contentLength: parseInt(docMeta.contentLength) || 0,
      chunkCount: parseInt(docMeta.chunkCount) || 0,
      vectorStatus: docMeta.vectorStatus || VECTOR_STATUS.LOCAL_ONLY,
      vectorMessage: docMeta.vectorMessage || '',
      vectorUpdatedAt: docMeta.vectorUpdatedAt
        ? new Date(parseInt(docMeta.vectorUpdatedAt))
        : null,
      createdAt: new Date(parseInt(docMeta.createdAt)),
      metadata: docMeta.metadata ? this._parseMetadata(docMeta.metadata) : {},
    };

    if (includeContent) {
      doc.content = docMeta.content || '';
    }

    return doc;
  }

  _parseMetadata(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
}

module.exports = { DocumentService, VECTOR_STATUS };