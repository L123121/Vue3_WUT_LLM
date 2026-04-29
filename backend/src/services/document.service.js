"use strict";

const { v4: uuidv4 } = require('uuid');
const { TextSplitter } = require('../utils/text-splitter');
const { chromaService } = require('./chroma.service');
const { redis } = require('./redis.service');

class DocumentService {
  constructor() {
    this.splitter = new TextSplitter({
      chunkSize: 500,
      chunkOverlap: 50
    });
    this.DOC_TTL = 30 * 24 * 60 * 60;
    this.embeddingService = null;
  }

  // 延迟初始化 EmbeddingService
  getEmbeddingService() {
    if (!this.embeddingService) {
      try {
        const { EmbeddingService } = require('./embedding.service');
        this.embeddingService = new EmbeddingService();
      } catch (e) {
        console.warn('[Document] EmbeddingService 初始化失败:', e.message);
      }
    }
    return this.embeddingService;
  }

  /**
   * 添加文档到知识库
   */
  async addDocument(doc) {
    const { title, content, category = 'general', metadata = {} } = doc;

    if (!content || content.trim().length === 0) {
      throw new Error('文档内容不能为空');
    }

    const docId = `doc_${uuidv4()}`;
    const now = Date.now();

    // 切片文档
    const chunks = this.splitter.splitByParagraph(content);
    console.log(`[Document] 文档切片完成: ${chunks.length} 段`);

    // 检查 Chroma 是否连接
    const useVector = chromaService.isConnected && this.getEmbeddingService();

    if (useVector) {
      try {
        // 批量获取向量
        const embeddings = await this.embeddingService.getEmbeddingsBatch(chunks);
        console.log(`[Document] 向量化完成: ${embeddings.length} 个向量`);

        // 存储到 Chroma
        const chunkDocuments = chunks.map((chunk, index) => ({
          id: `${docId}_chunk_${index}`,
          content: chunk,
          embedding: embeddings[index],
          metadata: {
            docId,
            title,
            category,
            chunkIndex: index,
            totalChunks: chunks.length,
            createdAt: now,
            ...metadata
          }
        }));

        await chromaService.addDocuments(chunkDocuments);
      } catch (e) {
        console.warn('[Document] 向量存储失败，仅保存元数据:', e.message);
      }
    } else {
      console.log('[Document] Chroma 未连接，仅保存文档元数据');
    }

    // 存储文档元数据到 Redis（用于管理）
    const docMetadata = {
      id: docId,
      title,
      category,
      content,
      contentLength: content.length,
      chunkCount: chunks.length,
      createdAt: now,
      metadata: JSON.stringify(metadata)
    };

    await redis.hset(`document:${docId}`, docMetadata);
    await redis.sadd('documents:all', docId);
    await redis.expire(`document:${docId}`, this.DOC_TTL);

    return {
      id: docId,
      title,
      chunkCount: chunks.length,
      message: '文档添加成功'
    };
  }

  /**
   * 批量添加文档
   */
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

  /**
   * 删除文档
   */
  async deleteDocument(docId) {
    const docMeta = await redis.hgetall(`document:${docId}`);
    if (!docMeta || !docMeta.id) {
      throw new Error('文档不存在');
    }

    // 删除 Chroma 中所有相关切片
    if (chromaService.isConnected) {
      const chunkCount = parseInt(docMeta.chunkCount) || 0;
      const chunkIds = [];
      for (let i = 0; i < chunkCount; i++) {
        chunkIds.push(`${docId}_chunk_${i}`);
      }
      await chromaService.deleteDocuments(chunkIds);
    }

    // 删除 Redis 元数据
    await redis.del(`document:${docId}`);
    await redis.srem('documents:all', docId);

    return { message: '文档删除成功', docId };
  }

  /**
   * 获取文档列表
   */
  async listDocuments(options = {}) {
    const { category, page = 1, limit = 20 } = options;

    let docIds = await redis.smembers('documents:all');

    const pipeline = redis.pipeline();
    docIds.forEach(id => pipeline.hgetall(`document:${id}`));
    const results = await pipeline.exec();

    let documents = results
      .map(([err, data]) => data)
      .filter(d => d && d.id)
      .map(d => ({
        id: d.id,
        title: d.title,
        category: d.category,
        contentLength: parseInt(d.contentLength) || 0,
        chunkCount: parseInt(d.chunkCount) || 0,
        createdAt: new Date(parseInt(d.createdAt))
      }));

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
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * 获取文档详情
   */
  async getDocument(docId) {
    const docMeta = await redis.hgetall(`document:${docId}`);
    if (!docMeta || !docMeta.id) {
      return null;
    }

    return {
      id: docMeta.id,
      title: docMeta.title,
      category: docMeta.category,
      content: docMeta.content || '',
      contentLength: parseInt(docMeta.contentLength) || 0,
      chunkCount: parseInt(docMeta.chunkCount) || 0,
      createdAt: new Date(parseInt(docMeta.createdAt)),
      metadata: docMeta.metadata ? JSON.parse(docMeta.metadata) : {}
    };
  }
}

module.exports = { DocumentService };
