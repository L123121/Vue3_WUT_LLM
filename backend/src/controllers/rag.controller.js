"use strict";

const path = require('path');
const { RagService } = require('../services/rag.service');
const { aiService } = require('../services/ai.service');
const { DocumentService } = require('../services/document.service');
const { redis: store } = require('../services/memory-store');
const { MemoryService } = require('../services/memory.service');
const { successResponse, errorResponse } = require('../utils/response');
const { upload, parseFile, cleanupFile } = require('../services/file-upload.service');

const ragService = new RagService(aiService);
const memoryService = new MemoryService();
const documentService = new DocumentService();
const FEEDBACK_RATINGS = new Set(['like', 'dislike']);
const FEEDBACK_TEXT_LIMIT = 4000;
const FEEDBACK_EVENT_LIMIT = 500;
const FEEDBACK_ALL_KEY = 'rag_feedback:all';
const FEEDBACK_ALL_EVENTS_KEY = 'rag_feedback_events:all';

function truncateFeedbackText(value, limit = FEEDBACK_TEXT_LIMIT) {
  const text = String(value || '').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function normalizeFeedbackSources(sources = []) {
  if (!Array.isArray(sources)) return [];
  return sources.slice(0, 8).map((source) => ({
    id: source.id ? String(source.id) : '',
    title: truncateFeedbackText(source.title, 160),
    category: source.category ? String(source.category) : '',
    score: Number.isFinite(Number(source.score)) ? Number(source.score) : null,
  }));
}

async function trimFeedbackEvents(eventsKey) {
  if (typeof store.llen !== 'function' || typeof store.ltrim !== 'function') return;
  const length = await store.llen(eventsKey);
  if (length > FEEDBACK_EVENT_LIMIT) {
    await store.ltrim(eventsKey, length - FEEDBACK_EVENT_LIMIT, -1);
  }
}

function parseFeedbackItem(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isAdminRequest(req) {
  return req.userId === 'admin';
}

function getTraceOptions(req, extra = {}) {
  return {
    ...extra,
    traceId: req.traceId,
    userId: req.userId,
    conversationId: req.body?.conversationId || req.get('x-conversation-id') || null,
  };
}

/**
 * 提取请求级阈值覆盖参数（A/B 评测用，正常用户请求不带这些字段不受影响）
 * 经 getTraceOptions 透传给 rag.service，由 _evalOverrides 校验后生效
 */
function getRerankOverrides(req) {
  const b = req.body || {};
  const overrides = {};
  for (const key of ['rerankMinScore', 'rerankDropoff', 'rerankTopK', 'maxContextLength']) {
    if (b[key] !== undefined && b[key] !== null && b[key] !== '') overrides[key] = b[key];
  }
  return overrides;
}

/**
 * RAG 增强聊天接口
 */
const ragChat = async (req, res, next) => {
  try {
    const { message, history, category } = req.body;

    if (!message) {
      return errorResponse(res, '消息内容不能为空', 400);
    }

    const result = await ragService.chat(message, history || [], getTraceOptions(req, { category, ...getRerankOverrides(req) }));
    res.setHeader('X-Trace-Id', result.traceId || req.traceId);
    successResponse(res, result, 'RAG 处理完成');
    memoryService.saveChatMemory(req.userId, message, result.reply);
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

    var _fullReply = '';
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 客户端断开 → 中止上游 LLM 流（注意监听 res 的 close，req 的 close 读完请求体即触发）
    const abortController = new AbortController();
    const onClientClose = () => abortController.abort();
    res.on('close', onClientClose);
    const streamOptions = getTraceOptions(req, {
      category,
      ...getRerankOverrides(req),
      signal: abortController.signal,
    });

    for await (const chunk of ragService.chatStream(message, history || [], streamOptions)) {
      if (chunk.type === 'retrieval') {
        res.write(`data: ${JSON.stringify({ traceId: chunk.traceId || req.traceId, retrieval: chunk.retrieval, trace: chunk.trace })}\n\n`);
      } else if (chunk.type === 'sources') {
        res.write(`data: ${JSON.stringify({ traceId: req.traceId, sources: chunk.sources })}\n\n`);
      } else if (chunk.type === 'trace') {
        res.write(`data: ${JSON.stringify({ traceId: chunk.trace?.traceId || req.traceId, trace: chunk.trace })}\n\n`);
      } else if (chunk.type === 'process') {
        res.write(`data: ${JSON.stringify({ traceId: req.traceId, processCard: chunk.processCard })}\n\n`);
      } else if (chunk.type === 'content') {
        if (chunk.done) {
          res.write(`data: [DONE]\n\n`);
        } else {
          _fullReply += chunk.content || "";
          res.write(`data: ${JSON.stringify({ traceId: req.traceId, content: chunk.content })}\n\n`);
        }
      }
    }

    res.end();
    res.removeListener('close', onClientClose);

    memoryService.saveChatMemory(req.userId, message, _fullReply);
  } catch (error) {
    res.removeListener('close', onClientClose);
    // 客户端已断开：不再向其写入错误事件
    if (abortController.signal.aborted) return;
    console.error('[RAG Stream] 错误:', error);
    res.write(`data: ${JSON.stringify({ traceId: req.traceId, error: error.message })}\n\n`);
    res.end();
  }
};

/**
 * 提交 RAG 回答评价
 */
const submitFeedback = async (req, res, next) => {
  try {
    const {
      rating,
      messageId,
      conversationId,
      questionMessageId,
      question,
      answer,
      traceId,
      sources,
    } = req.body || {};

    if (!FEEDBACK_RATINGS.has(rating)) {
      return errorResponse(res, '评价类型无效', 400);
    }
    if (!messageId || !conversationId) {
      return errorResponse(res, '缺少消息或会话标识', 400);
    }

    const userId = req.userId || 'anonymous';
    const feedback = {
      id: `${conversationId}:${messageId}`,
      userId,
      conversationId: String(conversationId),
      messageId: String(messageId),
      questionMessageId: questionMessageId ? String(questionMessageId) : '',
      rating,
      question: truncateFeedbackText(question),
      answer: truncateFeedbackText(answer),
      traceId: traceId ? String(traceId) : '',
      sources: normalizeFeedbackSources(sources),
      createdAt: new Date().toISOString(),
    };

    const feedbackKey = `rag_feedback:${userId}`;
    const eventsKey = `rag_feedback_events:${userId}`;
    const feedbackEvent = {
      ...feedback,
      eventId: `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };

    await store.hset(feedbackKey, feedback.id, feedback);
    await store.hset(FEEDBACK_ALL_KEY, `${userId}:${feedback.id}`, feedback);
    await store.rpush(eventsKey, JSON.stringify(feedbackEvent));
    await store.rpush(FEEDBACK_ALL_EVENTS_KEY, JSON.stringify(feedbackEvent));
    await trimFeedbackEvents(eventsKey);
    await trimFeedbackEvents(FEEDBACK_ALL_EVENTS_KEY);

    successResponse(res, { feedbackId: feedback.id, rating: feedback.rating }, '评价已记录');
  } catch (error) {
    console.error('[RAG Feedback] 提交失败:', error);
    next(error);
  }
};

/**
 * 管理员查询 RAG 回答评价
 */
const listFeedback = async (req, res, next) => {
  try {
    if (!isAdminRequest(req)) {
      return errorResponse(res, '仅管理员可查看反馈', 403);
    }

    const {
      rating,
      q = '',
      page = 1,
      limit = 20,
    } = req.query || {};
    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
    const keyword = String(q || '').trim().toLowerCase();

    const all = await store.hgetall(FEEDBACK_ALL_KEY);
    const feedbackList = Object.values(all || {})
      .map(parseFeedbackItem)
      .filter(Boolean)
      .filter((item) => !rating || item.rating === rating)
      .filter((item) => {
        if (!keyword) return true;
        const haystack = [
          item.userId,
          item.question,
          item.answer,
          item.traceId,
          item.conversationId,
          ...(item.sources || []).map((source) => source.title || source.category || ''),
        ].join(' ').toLowerCase();
        return haystack.includes(keyword);
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const total = feedbackList.length;
    const start = (pageNumber - 1) * pageSize;
    const items = feedbackList.slice(start, start + pageSize);
    const summary = feedbackList.reduce((acc, item) => {
      acc.total += 1;
      if (item.rating === 'like') acc.like += 1;
      if (item.rating === 'dislike') acc.dislike += 1;
      return acc;
    }, { total: 0, like: 0, dislike: 0 });

    successResponse(res, {
      items,
      summary,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.max(Math.ceil(total / pageSize), 1),
      },
    }, '获取反馈成功');
  } catch (error) {
    console.error('[RAG Feedback] 查询失败:', error);
    next(error);
  }
};

/**
 * RAG 离线评估检索接口：只返回 TopN 子句聚合后的父段候选，不调用 LLM 生成
 */
const retrieveParentCandidates = async (req, res, next) => {
  try {
    const { message, query, category, childTopK = 25, parentTopK = 0, includeChildren = true } = req.body;
    const searchQuery = message || query;

    if (!searchQuery) {
      return errorResponse(res, '检索 Query 不能为空', 400);
    }

    const result = await ragService.retrieveParentCandidates(searchQuery, getTraceOptions(req, {
      category,
      childTopK,
      parentTopK,
      includeChildren,
    }));
    res.setHeader('X-Trace-Id', result.traceId || req.traceId);

    successResponse(res, result, '检索候选获取完成');
  } catch (error) {
    console.error('[RAG Retrieval Eval] 错误:', error);
    next(error);
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
    const docCount = await store.scard('documents:all');

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

    const title = req.body.title || path.basename(originalName, path.extname(originalName));

    const result = await documentService.addDocument({
      title,
      content: content.trim(),
      category,
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

/**
 * 全量重建向量索引（重新切片 + 重新向量化所有文档）
 * 用于段落实分割策略变更后使已有文档生效新逻辑。
 */
const reindexAll = async (req, res, next) => {
  try {
    const { category } = req.body;
    const result = await documentService.listDocuments({ category, limit: 999 });
    const docs = result.documents;

    if (docs.length === 0) {
      return successResponse(res, { reindexed: 0, message: '没有文档需要重索引' }, '完成');
    }

    // 全量获取文档完整内容
    const fullDocs = await Promise.all(
      docs.map(d => documentService.getDocument(d.id))
    );
    const validDocs = fullDocs.filter(Boolean);

    console.log(`[Reindex] 开始全量重索引，共 ${validDocs.length} 个文档`);

    // 重建向量索引（先清空 collection，再逐个索引）
    const { IndexingService } = require('../services/indexing.service');
    const indexingService = new IndexingService();
    const totalChunks = await indexingService.reindexAll(validDocs);

    console.log(`[Reindex] 全量重索引完成，共 ${totalChunks} 个句子向量`);

    successResponse(res, {
      reindexed: validDocs.length,
      totalChunks,
      documents: validDocs.map(d => ({ id: d.id, title: d.title, category: d.category })),
    }, `重索引完成：${validDocs.length} 个文档，${totalChunks} 个向量`);
  } catch (error) {
    console.error('[Reindex] 重索引失败:', error);
    next(error);
  }
};

const uploadMiddleware = upload.single('file');

module.exports = {
  ragChat,
  ragChatStream,
  submitFeedback,
  listFeedback,
  retrieveParentCandidates,
  addDocument,
  addDocuments,
  deleteDocument,
  listDocuments,
  getDocument,
  getStats,
  uploadDocument,
  uploadMiddleware,
  reindexAll,
};






