"use strict";

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const ragController = require('../controllers/rag.controller');

const router = Router();

// RAG 接口需要登录（消耗 ChatDoc 额度和 LLM 配额）
router.use(requireAuth);

// RAG 聊天接口
router.post('/chat', ragController.ragChat);
router.post('/chat/stream', ragController.ragChatStream);

// 文档管理接口
router.post('/documents', ragController.addDocument);
router.post('/documents/upload', ragController.uploadMiddleware, ragController.uploadDocument);
router.post('/documents/batch', ragController.addDocuments);
router.get('/documents', ragController.listDocuments);
router.get('/documents/:id', ragController.getDocument);
router.delete('/documents/:id', ragController.deleteDocument);

// 统计信息
router.get('/stats', ragController.getStats);

module.exports = router;
