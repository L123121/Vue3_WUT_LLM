const { Router } = require('express');
const conversationsRoutes = require('./conversations.routes');
const ragRoutes = require('./rag.routes');
const evalRoutes = require('./eval.routes');
const shareRoutes = require('./share.routes');
const { createMemoryRoutes } = require('./memory.routes');
const { MemoryService } = require('../services/memory.service');

const router = Router();
const memoryService = new MemoryService();

// 聊天接口（/api/chat, /api/stream）已在 register.js 中注册
router.use('/conversations', conversationsRoutes);
router.use('/rag', ragRoutes);
router.use('/eval', evalRoutes);
router.use('/share', shareRoutes);
router.use('/memory', createMemoryRoutes(memoryService));

module.exports = { router, memoryService };
