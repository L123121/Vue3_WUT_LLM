const { Router } = require('express');
const authRoutes = require('./auth.routes');
const todoRoutes = require('./todo.routes');
const chatRoutes = require('./chat.routes');
const conversationsRoutes = require('./conversations.routes');
const ragRoutes = require('./rag.routes');

const router = Router();
router.use('/auth', authRoutes);
router.use('/todos', todoRoutes);
router.use('/chat', chatRoutes);
router.use('/conversations', conversationsRoutes);
router.use('/rag', ragRoutes);

module.exports = router;
