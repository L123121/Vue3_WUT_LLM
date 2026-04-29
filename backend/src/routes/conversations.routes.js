const { Router } = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const { conversationStore } = require('../services/redis.service');

const router = Router();

// 所有会话接口都需要认证
router.use(authMiddleware);

/**
 * 获取用户所有会话列表
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const conversations = await conversationStore.getConversations(userId);
    res.json({ success: true, data: conversations });
  } catch (error) {
    console.error('获取会话列表失败:', error);
    res.status(500).json({ success: false, error: '获取会话列表失败' });
  }
});

/**
 * 创建新会话
 */
router.post('/', async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { title } = req.body;
    const conversation = await conversationStore.createConversation(userId, title);
    res.json({ success: true, data: conversation });
  } catch (error) {
    console.error('创建会话失败:', error);
    res.status(500).json({ success: false, error: '创建会话失败' });
  }
});

/**
 * 获取单个会话详情
 */
router.get('/:id', async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const convId = req.params.id;
    const conversation = await conversationStore.getConversation(userId, convId);
    if (!conversation) {
      return res.status(404).json({ success: false, error: '会话不存在' });
    }
    res.json({ success: true, data: conversation });
  } catch (error) {
    console.error('获取会话详情失败:', error);
    res.status(500).json({ success: false, error: '获取会话详情失败' });
  }
});

/**
 * 重命名会话
 */
router.put('/:id', async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const convId = req.params.id;
    const { title } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: '标题不能为空' });
    }
    const success = await conversationStore.renameConversation(userId, convId, title.trim());
    if (!success) {
      return res.status(404).json({ success: false, error: '会话不存在' });
    }
    res.json({ success: true, message: '重命名成功' });
  } catch (error) {
    console.error('重命名会话失败:', error);
    res.status(500).json({ success: false, error: '重命名会话失败' });
  }
});

/**
 * 删除会话
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const convId = req.params.id;
    const success = await conversationStore.deleteConversation(userId, convId);
    if (!success) {
      return res.status(404).json({ success: false, error: '会话不存在' });
    }
    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    console.error('删除会话失败:', error);
    res.status(500).json({ success: false, error: '删除会话失败' });
  }
});

/**
 * 清空会话消息
 */
router.delete('/:id/messages', async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const convId = req.params.id;
    const success = await conversationStore.clearMessages(userId, convId);
    if (!success) {
      return res.status(404).json({ success: false, error: '会话不存在' });
    }
    res.json({ success: true, message: '清空成功' });
  } catch (error) {
    console.error('清空消息失败:', error);
    res.status(500).json({ success: false, error: '清空消息失败' });
  }
});

module.exports = router;
