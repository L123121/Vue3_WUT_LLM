const { Router } = require('express');
const conversationsRoutes = require('./conversations.routes');
const ragRoutes = require('./rag.routes');
const schoolRoutes = require('./school.routes');
const evalRoutes = require('./eval.routes');
const { createToolRoutes } = require('./tool.routes');
const { createMemoryRoutes } = require('./memory.routes');
const { toolRegistry } = require('../services/agent-tools');
const { MemoryService } = require('../services/memory.service');

const router = Router();
const memoryService = new MemoryService();

// 聊天接口（/api/chat, /api/stream, /api/chat/title）已在 app.js 中内联注册
router.use('/conversations', conversationsRoutes);
router.use('/rag', ragRoutes);
router.use('/school', schoolRoutes);
router.use('/eval', evalRoutes);
router.use('/tools', createToolRoutes(toolRegistry));
router.use('/memory', createMemoryRoutes(memoryService));

module.exports = { router, memoryService };
