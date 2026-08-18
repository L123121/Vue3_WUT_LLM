"use strict";

const { v4: uuidv4 } = require('uuid');
const { TextSplitter } = require('../utils/text-splitter');
const { redis: store } = require('./memory-store');

const VECTOR_STATUS = Object.freeze({
  LOCAL_ONLY: 'local_only',
  INDEXING: 'indexing',
  READY: 'ready',
  FAILED: 'failed',
});

class DocumentService {
  constructor(options = {}) {
    this.splitter = new TextSplitter({
      chunkSize: 500,
      chunkOverlap: 50,
    });
    this.store = options.store || store;
    // 延迟初始化：避免模块加载时的循环依赖
    this._indexing = options.indexingService || null;
    this._providerRegistered = false;
  }

  // 延迟获取 IndexingService（首次用时才 require）
  get indexingService() {
    if (!this._indexing) {
      const { IndexingService } = require('./indexing.service');
      // 传入全局向量库单例，保证索引写入同一个实例
      const { vectorStore } = require('./vector-store.service');
      this._indexing = new IndexingService(vectorStore);
      if (!this._providerRegistered) {
        const { registerDocumentProvider } = require('./vector-store.service');
        registerDocumentProvider(() => this._allDocs());
        this._providerRegistered = true;
      }
    }
    return this._indexing;
  }

  /**
   * 返回所有文档的索引信息（供向量库重建用）
   */
  async _allDocs() {
    const docIds = await this.store.smembers('documents:all');
    const pipeline = this.store.pipeline();
    docIds.forEach(id => pipeline.hgetall(`document:${id}`));
    const results = await pipeline.exec();
    return results
      .map(([, data]) => data)
      .filter(d => d && d.id)
      .map(d => ({ id: d.id, title: d.title, content: d.content, category: d.category }));
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

    const docMetadata = {
      id: docId,
      title,
      category,
      content,
      contentLength: content.length,
      chunkCount: chunks.length,
      createdAt: now,
      vectorStatus: VECTOR_STATUS.INDEXING,
      vectorMessage: '正在建立向量索引',
      vectorUpdatedAt: now,
      metadata: JSON.stringify(metadata),
    };

    await this.store.hset(`document:${docId}`, docMetadata);
    await this.store.sadd('documents:all', docId);

    const indexPromise = this.indexingService.indexDocument(docId, title, content, category)
      .then(async indexedChunkCount => {
        if (!Number.isFinite(indexedChunkCount) || indexedChunkCount <= 0) {
          throw new Error('未生成可用向量');
        }

        const vectorMessage = `已生成 ${indexedChunkCount} 个向量`;
        await this.store.hset(`document:${docId}`, {
          vectorStatus: VECTOR_STATUS.READY,
          vectorMessage,
          vectorUpdatedAt: Date.now(),
          indexedChunkCount,
        });
        console.log(`[Document] 向量索引完成: ${docId}, ${indexedChunkCount} 切片`);
        return {
          vectorStatus: VECTOR_STATUS.READY,
          vectorMessage,
          indexedChunkCount,
        };
      })
      .catch(async err => {
        const vectorMessage = err.message || '向量索引失败';
        await this.store.hset(`document:${docId}`, {
          vectorStatus: VECTOR_STATUS.FAILED,
          vectorMessage,
          vectorUpdatedAt: Date.now(),
        });
        console.error(`[Document] 向量索引失败: ${docId}`, vectorMessage);
        return {
          vectorStatus: VECTOR_STATUS.FAILED,
          vectorMessage,
          indexedChunkCount: 0,
        };
      });

    // 最多等待 30 秒；超时后索引仍在后台继续，并会最终更新文档状态
    let timeoutId;
    const outcome = await Promise.race([
      indexPromise,
      new Promise(resolve => {
        timeoutId = setTimeout(() => resolve({
          vectorStatus: VECTOR_STATUS.INDEXING,
          vectorMessage: '索引仍在后台处理中，请稍后刷新确认',
          indexedChunkCount: 0,
        }), 30000);
      }),
    ]);
    if (timeoutId) clearTimeout(timeoutId);

    return {
      id: docId,
      title,
      chunkCount: chunks.length,
      indexedChunkCount: outcome.indexedChunkCount,
      vectorStatus: outcome.vectorStatus,
      vectorMessage: outcome.vectorMessage,
      message: outcome.vectorStatus === VECTOR_STATUS.READY
        ? '文档添加成功，向量索引已完成'
        : '文档已保存，但向量索引尚未完成',
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
    const docMeta = await this.store.hgetall(`document:${docId}`);
    if (!docMeta || !docMeta.id) {
      throw new Error('文档不存在');
    }

    // 异步删除向量索引（不阻塞响应）
    this.indexingService.removeDocument(docId).catch(err => {
      console.warn(`[Document] 向量索引删除失败: ${docId}`, err.message);
    });

    await this.store.del(`document:${docId}`);
    await this.store.srem('documents:all', docId);

    return { message: '文档删除成功', docId };
  }

  /**
   * 轻量判断文档库是否为空（无分类时用 scard，避免 listDocuments 的全量读取）
   */
  async hasDocuments(category) {
    if (!category) {
      return (await this.store.scard('documents:all')) > 0;
    }
    const docs = await this.listDocuments({ category, limit: 1 });
    return docs.documents.length > 0;
  }

  async listDocuments(options = {}) {
    const { category, page = 1, limit = 20 } = options;

    const docIds = await this.store.smembers('documents:all');

    const pipeline = this.store.pipeline();
    docIds.forEach(id => pipeline.hgetall(`document:${id}`));
    const results = await pipeline.exec();

    let documents = results
      .map(([, data]) => data)
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
    const docMeta = await this.store.hgetall(`document:${docId}`);
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
