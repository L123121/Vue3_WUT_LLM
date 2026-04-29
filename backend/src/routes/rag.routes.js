"use strict";

const { Router } = require('express');
const ragController = require('../controllers/rag.controller');

const router = Router();

// RAG 聊天接口（公开）
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

// 测试接口
router.get('/test/embedding', ragController.testEmbedding);

module.exports = router;
