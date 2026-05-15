"use strict";

const path = require('path');
const { RagService } = require('../services/rag.service');
const { DocumentService } = require('../services/document.service');
const { redis } = require('../services/redis.service');
const { successResponse, errorResponse } = require('../utils/response');
const { upload, parseFile, cleanupFile } = require('../services/file-upload.service');

const ragService = new RagService();
const documentService = new DocumentService();

/**
 * RAG 增强聊天接口
 */
const ragChat = async (req, res, next) => {
  try {
    const { message, history, category } = req.body;

    if (!message) {
      return errorResponse(res, '消息内容不能为空', 400);
    }

    const result = await ragService.chat(message, history || [], { category });
    successResponse(res, result, 'RAG 处理完成');
  } catch (error) {
    console.error('[RAG Controller] 错误:', error);
    next(error);
  }
};

/**
 * RAG 增强流式聊天接口
 */
const ragChatStream = async (req, res, next) => {
  try {
    const { message, history, category } = req.body;

    if (!message) {
      return res.status(400).json({ error: '消息内容不能为空' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    for await (const chunk of ragService.chatStream(message, history || [], { category })) {
      if (chunk.type === 'sources') {
        res.write(`data: ${JSON.stringify({ sources: chunk.sources })}\n\n`);
      } else if (chunk.type === 'content') {
        if (chunk.done) {
          res.write(`data: [DONE]\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
        }
      }
    }

    res.end();
  } catch (error) {
    console.error('[RAG Stream] 错误:', error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
};

/**
 * 添加文档
 */
const addDocument = async (req, res, next) => {
  try {
    const { title, content, category, metadata } = req.body;

    if (!content) {
      return errorResponse(res, '文档内容不能为空', 400);
    }

    const result = await documentService.addDocument({
      title: title || '未命名文档',
      content,
      category: category || 'general',
      metadata
    });

    successResponse(res, result, '文档添加成功');
  } catch (error) {
    console.error('[Document] 添加失败:', error);
    next(error);
  }
};

/**
 * 批量添加文档
 */
const addDocuments = async (req, res, next) => {
  try {
    const { documents } = req.body;

    if (!Array.isArray(documents) || documents.length === 0) {
      return errorResponse(res, '文档列表不能为空', 400);
    }

    const results = await documentService.addDocuments(documents);
    successResponse(res, results, '批量添加完成');
  } catch (error) {
    console.error('[Document] 批量添加失败:', error);
    next(error);
  }
};

/**
 * 删除文档
 */
const deleteDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await documentService.deleteDocument(id);
    successResponse(res, result, '文档删除成功');
  } catch (error) {
    console.error('[Document] 删除失败:', error);
    next(error);
  }
};

/**
 * 获取文档列表
 */
const listDocuments = async (req, res, next) => {
  try {
    const { category, page, limit } = req.query;
    const result = await documentService.listDocuments({
      category,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20
    });
    successResponse(res, result, '获取成功');
  } catch (error) {
    console.error('[Document] 获取列表失败:', error);
    next(error);
  }
};

/**
 * 获取文档详情
 */
const getDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await documentService.getDocument(id);

    if (!result) {
      return errorResponse(res, '文档不存在', 404);
    }

    successResponse(res, result, '获取成功');
  } catch (error) {
    console.error('[Document] 获取详情失败:', error);
    next(error);
  }
};

/**
 * 获取知识库统计
 */
const getStats = async (req, res, next) => {
  try {
    const docCount = await redis.scard('documents:all');

    successResponse(res, {
      documents: {
        count: docCount
      }
    }, '获取成功');
  } catch (error) {
    console.error('[RAG Stats] 获取失败:', error);
    successResponse(res, {
      documents: { count: 0 }
    }, '获取成功');
  }
};

/**
 * 上传文件并添加到知识库
 */
const uploadDocument = async (req, res, next) => {
  let filePath = null;

  try {
    if (!req.file) {
      return errorResponse(res, '请上传文件', 400);
    }

    filePath = req.file.path;
    const originalName = req.file.originalname;
    const category = req.body.category || 'general';

    console.log(`[FileUpload] 解析文件: ${originalName}`);

    // 解析文件内容
    const content = await parseFile(filePath, originalName);

    if (!content || content.trim().length === 0) {
      return errorResponse(res, '文件内容为空或无法解析', 400);
    }

    // 读取文件 buffer 用于上传到星火知识库
    const fs = require('fs');
    const fileBuffer = await fs.promises.readFile(filePath);

    const title = req.body.title || path.basename(originalName, path.extname(originalName));

    const result = await documentService.addDocument({
      title,
      content: content.trim(),
      category,
      fileBuffer,
      fileName: originalName,
      metadata: {
        sourceFile: originalName,
        fileType: path.extname(originalName).toLowerCase()
      }
    });

    console.log(`[FileUpload] 文件解析成功: ${originalName} -> ${result.chunkCount} 个片段`);

    successResponse(res, {
      ...result,
      sourceFile: originalName,
      contentLength: content.length
    }, result.message || '文件上传成功');
  } catch (error) {
    console.error('[FileUpload] 上传失败:', error);
    next(error);
  } finally {
    if (filePath) {
      cleanupFile(filePath);
    }
  }
};

const uploadMiddleware = upload.single('file');

module.exports = {
  ragChat,
  ragChatStream,
  addDocument,
  addDocuments,
  deleteDocument,
  listDocuments,
  getDocument,
  getStats,
  uploadDocument,
  uploadMiddleware
};
