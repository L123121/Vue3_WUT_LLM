"use strict";

const { v4: uuidv4 } = require('uuid');
const { TextSplitter } = require('../utils/text-splitter');
const { redis } = require('./redis.service');
const { ChatdocService } = require('./chatdoc.service');

class DocumentService {
  constructor() {
    this.splitter = new TextSplitter({
      chunkSize: 500,
      chunkOverlap: 50
    });
    this.DOC_TTL = 30 * 24 * 60 * 60;
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

    // 上传到星火知识库
    let chatdocFileId = null;
    if (fileBuffer && fileName) {
      try {
        console.log(`[Document] 上传到星火知识库: ${fileName}`);
        const uploadResult = await this.chatdocService.uploadDocument(fileBuffer, fileName);
        if (uploadResult.code === 0 && uploadResult.data?.fileId) {
          chatdocFileId = uploadResult.data.fileId;
          console.log(`[Document] 星火知识库上传成功, fileId: ${chatdocFileId}`);

          // 后台异步等待向量化（不阻塞响应）
          this.chatdocService.waitForVectoring(chatdocFileId, 30000).then(ok => {
            if (ok) console.log(`[Document] 星火知识库向量化完成`);
          }).catch(() => {});
        } else {
          console.warn(`[Document] 星火知识库上传失败: ${uploadResult.desc || uploadResult.message}`);
        }
      } catch (err) {
        console.warn(`[Document] 星火知识库上传异常: ${err.message}`);
      }
    }

    // 存储文档元数据到 Redis
    const docMetadata = {
      id: docId,
      title,
      category,
      content,
      contentLength: content.length,
      chunkCount: chunks.length,
      createdAt: now,
      chatdocFileId: chatdocFileId || '',
      metadata: JSON.stringify(metadata)
    };

    await redis.hset(`document:${docId}`, docMetadata);
    await redis.sadd('documents:all', docId);
    await redis.expire(`document:${docId}`, this.DOC_TTL);

    return {
      id: docId,
      title,
      chunkCount: chunks.length,
      chatdocFileId,
      message: chatdocFileId ? '文档添加成功（已同步到星火知识库）' : '文档添加成功（仅本地存储）'
    };
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
    const docMeta = await redis.hgetall(`document:${docId}`);
    if (!docMeta || !docMeta.id) {
      throw new Error('文档不存在');
    }

    await redis.del(`document:${docId}`);
    await redis.srem('documents:all', docId);

    return { message: '文档删除成功', docId };
  }

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
        chatdocFileId: d.chatdocFileId || '',
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
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  async getDocument(docId) {
    const docMeta = await redis.hgetall(`document:${docId}`);
    if (!docMeta || !docMeta.id) return null;

    return {
      id: docMeta.id,
      title: docMeta.title,
      category: docMeta.category,
      content: docMeta.content || '',
      contentLength: parseInt(docMeta.contentLength) || 0,
      chunkCount: parseInt(docMeta.chunkCount) || 0,
      chatdocFileId: docMeta.chatdocFileId || '',
      createdAt: new Date(parseInt(docMeta.createdAt)),
      metadata: docMeta.metadata ? JSON.parse(docMeta.metadata) : {}
    };
  }

  async getAllChatdocFileIds() {
    const docIds = await redis.smembers('documents:all');
    if (!docIds.length) return [];

    const pipeline = redis.pipeline();
    docIds.forEach(id => pipeline.hget(`document:${id}`, 'chatdocFileId'));
    const results = await pipeline.exec();

    return results
      .map(([err, data]) => data)
      .filter(id => id && id.length > 0);
  }
}

module.exports = { DocumentService };
