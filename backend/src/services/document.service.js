"use strict";

const { v4: uuidv4 } = require('uuid');
const { TextSplitter } = require('../utils/text-splitter');
const { redis: store } = require('./memory-store');
const { ChatdocService } = require('./chatdoc.service');

const VECTOR_STATUS = Object.freeze({
  LOCAL_ONLY: 'local_only',
  VECTORING: 'vectoring',
  READY: 'ready',
  FAILED: 'failed',
  TIMEOUT: 'timeout'
});

class DocumentService {
  constructor() {
    this.splitter = new TextSplitter({
      chunkSize: 500,
      chunkOverlap: 50
    });
    this.chatdocService = new ChatdocService();
  }

  /**
   * 添加文档到知识库（同步到星火知识库）
   */
  async addDocument(doc) {
    const { title, content, category = 'general', metadata = {}, fileBuffer, fileName } = doc;

    if (!content || content.trim().length === 0) {
      throw new Error('文档内容不能为空');
    }

    const docId = `doc_${uuidv4()}`;
    const now = Date.now();

    const chunks = this.splitter.splitByParagraph(content);
    console.log(`[Document] 文档切片完成: ${chunks.length} 段`);

    let chatdocFileId = null;
    let vectorStatus = fileBuffer && fileName ? VECTOR_STATUS.FAILED : VECTOR_STATUS.LOCAL_ONLY;
    let vectorMessage = fileBuffer && fileName ? '等待上传到星火知识库' : '仅本地存储，暂不参与星火检索';

    if (fileBuffer && fileName) {
      try {
        console.log(`[Document] 上传到星火知识库: ${fileName}`);
        const uploadResult = await this.chatdocService.uploadDocument(fileBuffer, fileName);
        if (uploadResult.code === 0 && uploadResult.data?.fileId) {
          chatdocFileId = uploadResult.data.fileId;
          vectorStatus = VECTOR_STATUS.VECTORING;
          vectorMessage = '星火知识库向量化中';
          console.log(`[Document] 星火知识库上传成功, fileId: ${chatdocFileId}`);
        } else {
          vectorMessage = uploadResult.desc || uploadResult.message || '星火知识库上传失败';
          console.warn(`[Document] 星火知识库上传失败: ${vectorMessage}`);
        }
      } catch (err) {
        vectorMessage = err.message;
        console.warn(`[Document] 星火知识库上传异常: ${err.message}`);
      }
    }

    const docMetadata = {
      id: docId,
      title,
      category,
      content,
      contentLength: content.length,
      chunkCount: chunks.length,
      createdAt: now,
      chatdocFileId: chatdocFileId || '',
      vectorStatus,
      vectorMessage,
      vectorUpdatedAt: now,
      metadata: JSON.stringify(metadata)
    };

    await store.hset(`document:${docId}`, docMetadata);
    await store.sadd('documents:all', docId);

    if (chatdocFileId) {
      this._trackVectoringStatus(docId, chatdocFileId);
    }

    return {
      id: docId,
      title,
      chunkCount: chunks.length,
      chatdocFileId,
      vectorStatus,
      vectorMessage,
      message: chatdocFileId ? '文档添加成功（已同步到星火知识库）' : '文档添加成功（仅本地存储）'
    };
  }

  _trackVectoringStatus(docId, chatdocFileId) {
    this.chatdocService.waitForVectoring(chatdocFileId, 30000).then(async ok => {
      if (ok) {
        console.log(`[Document] 星火知识库向量化完成: ${chatdocFileId}`);
        await this._setVectorStatus(docId, VECTOR_STATUS.READY, '星火知识库向量化完成');
      } else {
        await this._setVectorStatus(docId, VECTOR_STATUS.TIMEOUT, '向量化状态暂未确认，后续查询会继续尝试');
      }
    }).catch(async err => {
      await this._setVectorStatus(docId, VECTOR_STATUS.FAILED, err.message);
    });
  }

  async _setVectorStatus(docId, vectorStatus, vectorMessage = '') {
    const docMeta = await store.hgetall(`document:${docId}`);
    if (!docMeta || !docMeta.id) return;

    await store.hset(`document:${docId}`, {
      vectorStatus,
      vectorMessage,
      vectorUpdatedAt: Date.now()
    });
  }

  async addDocuments(docs) {
    const results = [];
    for (const doc of docs) {
      try {
        const result = await this.addDocument(doc);
        results.push(result);
      } catch (error) {
        console.error(`[Document] 添加文档失败: ${doc.title}`, error.message);
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
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  async getDocument(docId) {
    const docMeta = await store.hgetall(`document:${docId}`);
    if (!docMeta || !docMeta.id) return null;

    return this._normalizeDocMeta(docMeta, { includeContent: true });
  }

  async getAllChatdocFileIds(options = {}) {
    const { category, includePending = false } = options;
    const docIds = await this._getAllDocIds();
    if (!docIds.length) return [];

    const pipeline = store.pipeline();
    docIds.forEach(id => pipeline.hgetall(`document:${id}`));
    const results = await pipeline.exec();

    return results
      .map(([err, data]) => data)
      .filter(d => d && d.id && d.chatdocFileId)
      .filter(d => !category || d.category === category)
      .filter(d => includePending || this._isSearchableVector(d))
      .map(d => d.chatdocFileId);
  }

  async getDocumentsByChatdocFileIds(fileIds) {
    if (!fileIds || fileIds.length === 0) return new Map();

    const wanted = new Set(fileIds);
    const docIds = await this._getAllDocIds();
    if (!docIds.length) return new Map();

    const pipeline = store.pipeline();
    docIds.forEach(id => pipeline.hgetall(`document:${id}`));
    const results = await pipeline.exec();

    const docsByFileId = new Map();
    results
      .map(([err, data]) => data)
      .filter(d => d && d.id && wanted.has(d.chatdocFileId))
      .forEach(d => {
        docsByFileId.set(d.chatdocFileId, this._normalizeDocMeta(d, { includeContent: true }));
      });

    return docsByFileId;
  }

  /**
   * 获取所有文档 ID（内部辅助方法）
   */
  async _getAllDocIds() {
    return await store.smembers('documents:all');
  }

  /**
   * 获取单个文档的原始元数据哈希（内部辅助方法）
   */
  async _getDocMeta(docId) {
    return await store.hgetall(`document:${docId}`);
  }

  /**
   * 根据 chatdocFileId 查找本地文档 ID
   */
  async findDocByChatdocFileId(chatdocFileId) {
    const docIds = await this._getAllDocIds();
    for (const docId of docIds) {
      const meta = await store.hget(`document:${docId}`, 'chatdocFileId');
      if (meta === chatdocFileId) return docId;
    }
    return null;
  }

  _normalizeDocMeta(docMeta, { includeContent = false } = {}) {
    const doc = {
      id: docMeta.id,
      title: docMeta.title,
      category: docMeta.category,
      contentLength: parseInt(docMeta.contentLength) || 0,
      chunkCount: parseInt(docMeta.chunkCount) || 0,
      chatdocFileId: docMeta.chatdocFileId || '',
      vectorStatus: this._normalizeVectorStatus(docMeta),
      vectorMessage: docMeta.vectorMessage || '',
      vectorUpdatedAt: docMeta.vectorUpdatedAt ? new Date(parseInt(docMeta.vectorUpdatedAt)) : null,
      createdAt: new Date(parseInt(docMeta.createdAt)),
      metadata: docMeta.metadata ? this._parseMetadata(docMeta.metadata) : {}
    };

    if (includeContent) {
      doc.content = docMeta.content || '';
    }

    return doc;
  }

  _normalizeVectorStatus(docMeta) {
    if (docMeta.vectorStatus) return docMeta.vectorStatus;
    return docMeta.chatdocFileId ? VECTOR_STATUS.READY : VECTOR_STATUS.LOCAL_ONLY;
  }

  _isSearchableVector(docMeta) {
    const vectorStatus = this._normalizeVectorStatus(docMeta);
    return vectorStatus === VECTOR_STATUS.READY || vectorStatus === VECTOR_STATUS.TIMEOUT;
  }

  _parseMetadata(raw) {
    try {
      return JSON.parse(raw);
    } catch (err) {
      return {};
    }
  }
}

module.exports = { DocumentService, VECTOR_STATUS };
