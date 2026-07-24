"use strict";

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const ragController = require('../controllers/rag.controller');
const { getRecentRagTraces } = require('../services/rag-tracer.service');

const router = Router();

// RAG 接口需要登录
router.use(requireAuth);

// RAG 聊天接口
router.post('/chat', ragController.ragChat);
router.post('/chat/stream', ragController.ragChatStream);
router.get('/feedback', ragController.listFeedback);
router.post('/feedback', ragController.submitFeedback);

// 离线评估：只检索候选父段，不调用 LLM 生成
router.post('/retrieval/parents', ragController.retrieveParentCandidates);

// 文档管理接口
router.post('/documents', ragController.addDocument);
router.post('/documents/upload', ragController.uploadMiddleware, ragController.uploadDocument);
router.post('/documents/batch', ragController.addDocuments);
router.get('/documents', ragController.listDocuments);
router.get('/documents/:id', ragController.getDocument);
router.delete('/documents/:id', ragController.deleteDocument);

// 重索引
router.post('/documents/reindex', ragController.reindexAll);

// 统计信息
router.get('/stats', ragController.getStats);

// 最近 RAG 链路 trace（仅当前用户）
router.get('/traces', async (req, res) => {
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 20;

  try {
    const traces = await getRecentRagTraces(req.userId, limit);
    res.json({ success: true, data: traces });
  } catch (err) {
    console.error('[RAG Routes] 读取 RAG trace 失败:', err);
    res.status(500).json({ success: false, error: '读取 RAG trace 失败' });
  }
});

module.exports = router;
