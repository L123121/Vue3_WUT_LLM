"use strict";

const path = require('path');
const { RagService } = require('../services/rag.service');
const { aiService } = require('../services/ai.service');
const { DocumentService } = require('../services/document.service');
const { redis: store } = require('../services/memory-store');
const { MemoryService } = require('../services/memory.service');
const { successResponse, errorResponse } = require('../utils/response');
const { upload, parseFile, cleanupFile } = require('../services/file-upload.service');
const { recordAudit } = require('../services/quality-governance.service');

const ragService = new RagService(aiService);
const memoryService = new MemoryService();
const documentService = new DocumentService();
const FEEDBACK_RATINGS = new Set(['like', 'dislike']);
const FEEDBACK_TEXT_LIMIT = 4000;
const FEEDBACK_EVENT_LIMIT = 500;
const FEEDBACK_ALL_KEY = 'rag_feedback:all';
const FEEDBACK_ALL_EVENTS_KEY = 'rag_feedback_events:all';
// 反馈 → 评测集数据飞轮状态：queued = 已加入待导出队列（UI 一键操作）；
// exported = export-badcases.cjs 已写入评测数据集
const FEEDBACK_EVAL_STATUSES = new Set(['queued', 'exported']);

function saveChatMemory(userId, message, reply) {
  Promise.resolve(memoryService.saveChatMemory(userId, message, reply)).catch((error) => {
    console.error('[RAG Memory] 保存失败:', error.message);
  });
}

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

async function getAllFeedback() {
  const all = await store.hgetall(FEEDBACK_ALL_KEY);
  return Object.values(all || {}).map(parseFeedbackItem).filter(Boolean);
}

async function getFeedbackSummary() {
  const feedbackList = await getAllFeedback();
  const summary = feedbackList.reduce((acc, item) => {
    acc.total += 1;
    if (item.rating === 'like') acc.like += 1;
    if (item.rating === 'dislike') acc.dislike += 1;
    if (Array.isArray(item.sources) && item.sources.length > 0) acc.withSources += 1;
    return acc;
  }, { total: 0, like: 0, dislike: 0, withSources: 0 });
  return {
    ...summary,
    satisfactionRate: summary.total > 0 ? Math.round((summary.like / summary.total) * 1000) / 10 : null,
  };
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
    void recordAudit({
      question: message,
      answer: result.reply,
      sources: result.sources,
      traceId: result.traceId || req.traceId,
      userId: req.userId,
      route: 'rag-direct',
    }).catch((error) => console.warn('[QualityAudit] RAG 非流式记录失败:', error.message));
    successResponse(res, result, 'RAG 处理完成');
    saveChatMemory(req.userId, message, result.reply);
  } catch (error) {
    console.error('[RAG Controller] 错误:', error);
    next(error);
  }
};

/**
 * RAG 增强流式聊天接口
 */
const ragChatStream = async (req, res, next) => {
  let abortController = null;
  let onClientClose = null;
  const cleanupClientClose = () => {
    if (onClientClose) res.removeListener('close', onClientClose);
  };

  try {
    const { message, history, category } = req.body;

    if (!message) {
      return res.status(400).json({ error: '消息内容不能为空' });
    }

    let fullReply = '';
    const audit = { sources: [], traceId: req.traceId };
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 客户端断开 → 中止上游 LLM 流（注意监听 res 的 close，req 的 close 读完请求体即触发）
    abortController = new AbortController();
    onClientClose = () => abortController.abort();
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
        audit.sources = chunk.sources || [];
        res.write(`data: ${JSON.stringify({ traceId: req.traceId, sources: chunk.sources })}\n\n`);
      } else if (chunk.type === 'trace') {
        if (chunk.trace?.traceId) audit.traceId = chunk.trace.traceId;
        res.write(`data: ${JSON.stringify({ traceId: chunk.trace?.traceId || req.traceId, trace: chunk.trace })}\n\n`);
      } else if (chunk.type === 'process') {
        res.write(`data: ${JSON.stringify({ traceId: req.traceId, processCard: chunk.processCard })}\n\n`);
      } else if (chunk.type === 'grounding') {
        // 运行时引用校验结果：随收尾下发，前端标注溯源覆盖
        res.write(`data: ${JSON.stringify({ traceId: req.traceId, grounding: chunk.grounding })}\n\n`);
      } else if (chunk.type === 'followups') {
        // 追问建议：零成本从引用文档/章节标题生成，前端渲染为可点击 chips
        res.write(`data: ${JSON.stringify({ traceId: req.traceId, followups: chunk.items })}\n\n`);
      } else if (chunk.type === 'content') {
        if (chunk.done) {
          res.write(`data: [DONE]\n\n`);
        } else {
          fullReply += chunk.content || "";
          res.write(`data: ${JSON.stringify({ traceId: req.traceId, content: chunk.content })}\n\n`);
        }
      }
    }

    cleanupClientClose();
    res.end();

    void recordAudit({
      question: message,
      answer: fullReply,
      sources: audit.sources,
      traceId: audit.traceId,
      userId: req.userId,
      route: 'rag-direct-stream',
    }).catch((error) => console.warn('[QualityAudit] RAG 流式记录失败:', error.message));

    saveChatMemory(req.userId, message, fullReply);
  } catch (error) {
    cleanupClientClose();
    // 客户端已断开：不再向其写入错误事件
    if (abortController?.signal.aborted) return;
    console.error('[RAG Stream] 错误:', error);
    if (!res.headersSent) return next(error);
    try {
      res.write(`data: ${JSON.stringify({ traceId: req.traceId, error: error.message })}\n\n`);
      res.end();
    } catch {
      // 连接已关闭，忽略
    }
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

    const feedbackList = await getAllFeedback()
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
      if (item.evalStatus === 'queued') acc.evalQueued += 1;
      if (item.evalStatus === 'exported') acc.evalExported += 1;
      return acc;
    }, { total: 0, like: 0, dislike: 0, evalQueued: 0, evalExported: 0 });

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
 * 管理员更新反馈的评测集状态（反馈 → 评测集数据飞轮）：
 * 点踩反馈一键入队，导出脚本回写 exported，线上坏例形成回归覆盖闭环
 */
const updateFeedbackEvalStatus = async (req, res, next) => {
  try {
    if (!isAdminRequest(req)) {
      return errorResponse(res, '仅管理员可更新评测状态', 403);
    }

    const { userId, feedbackId, status } = req.body || {};
    if (!userId || !feedbackId) {
      return errorResponse(res, '缺少用户或反馈标识', 400);
    }
    if (!FEEDBACK_EVAL_STATUSES.has(status)) {
      return errorResponse(res, '评测状态无效', 400);
    }

    const userFeedback = await store.hgetall(`rag_feedback:${userId}`);
    const existing = userFeedback ? userFeedback[feedbackId] : null;
    if (!existing) {
      return errorResponse(res, '反馈不存在', 404);
    }

    const updated = {
      ...existing,
      evalStatus: status,
      evalStatusAt: new Date().toISOString(),
    };
    await store.hset(`rag_feedback:${userId}`, feedbackId, updated);
    await store.hset(FEEDBACK_ALL_KEY, `${userId}:${feedbackId}`, updated);

    successResponse(res, { feedbackId, evalStatus: status }, status === 'queued' ? '已加入评测集候选' : '已标记为已导出');
  } catch (error) {
    console.error('[RAG Feedback] 更新评测状态失败:', error);
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
const getStats = async (req, res, _next) => {
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
 * 重建向量索引
 * 默认 rebuild：reset collection 后全量重切片 + 重向量化（修复/策略变更用）。
 * body.mode = 'incremental'：逐文档内容 hash diff，未变段落复用已有向量，只重算变化部分。
 */
const reindexAll = async (req, res, next) => {
  try {
    const { category, mode: modeBody } = req.body || {};
    const mode = (modeBody === 'incremental' || req.query?.mode === 'incremental') ? 'incremental' : 'rebuild';
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

    console.log(`[Reindex] 开始${mode === 'incremental' ? '增量' : '全量'}重索引，共 ${validDocs.length} 个文档`);

    const { IndexingService } = require('../services/indexing.service');
    const indexingService = new IndexingService();
    const totalChunks = await indexingService.reindexAll(validDocs, { mode });

    const { reused = 0, embedded = 0 } = indexingService.lastReuseStats;

    console.log(`[Reindex] ${mode === 'incremental' ? '增量' : '全量'}重索引完成，共 ${totalChunks} 个句子向量`);

    successResponse(res, {
      reindexed: validDocs.length,
      totalChunks,
      mode,
      ...(mode === 'incremental' ? { reusedVectors: reused, recomputedVectors: embedded } : {}),
      documents: validDocs.map(d => ({ id: d.id, title: d.title, category: d.category })),
    }, mode === 'incremental'
      ? `增量重索引完成：${validDocs.length} 个文档，${totalChunks} 个向量（复用 ${reused}，重算 ${embedded}）`
      : `重索引完成：${validDocs.length} 个文档，${totalChunks} 个向量`);
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
  updateFeedbackEvalStatus,
  getFeedbackSummary,
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



