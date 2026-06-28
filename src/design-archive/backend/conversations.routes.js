const { Router } = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const { conversationStore, redis } = require('../services/memory-store');

const router = Router();

// 所有会话接口都需要认证
router.use(authMiddleware);

/**
 * 检查 Redis 是否可用
 */
const isRedisReady = () => redis && redis.status === 'ready';

/**
 * 获取用户所有会话列表
 */
router.get('/', async (req, res) => {
  try {
    if (!isRedisReady()) {
      // Redis 不可用时返回空列表，让前端使用本地存储
      return res.json({ success: true, data: [] });
    }

    const userId = req.user.userId || req.user.id;
    const conversations = await conversationStore.getConversations(userId);
    res.json({ success: true, data: conversations });
  } catch (error) {
    console.error('获取会话列表失败:', error.message);
    // 返回空列表而非 500，让前端降级到本地存储
    res.json({ success: true, data: [] });
  }
});

/**
 * 创建新会话
 */
router.post('/', async (req, res) => {
  try {
    if (!isRedisReady()) {
      return res.json({
        success: true,
        data: {
          id: `local_${Date.now()}`,
          title: req.body.title || '新会话',
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    const userId = req.user.userId || req.user.id;
    const { title } = req.body;
    const conversation = await conversationStore.createConversation(userId, title);
    res.json({ success: true, data: conversation });
  } catch (error) {
    console.error('创建会话失败:', error.message);
    res.json({
      success: true,
      data: {
        id: `local_${Date.now()}`,
        title: req.body.title || '新会话',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }
});

/**
 * 获取单个会话详情
 */
router.get('/:id', async (req, res) => {
  try {
    if (!isRedisReady()) {
      return res.status(404).json({ success: false, error: '会话不存在 (Redis 不可用)' });
    }

    const userId = req.user.userId || req.user.id;
    const convId = req.params.id;
    const conversation = await conversationStore.getConversation(userId, convId);
    if (!conversation) {
      return res.status(404).json({ success: false, error: '会话不存在' });
    }
    res.json({ success: true, data: conversation });
  } catch (error) {
    console.error('获取会话详情失败:', error.message);
    res.status(404).json({ success: false, error: '会话不存在' });
  }
});

/**
 * 重命名会话
 */
router.put('/:id', async (req, res) => {
  try {
    if (!isRedisReady()) {
      return res.json({ success: true, message: '重命名成功（仅本地）' });
    }

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
    console.error('重命名会话失败:', error.message);
    res.json({ success: true, message: '重命名成功（仅本地）' });
  }
});

/**
 * 删除会话
 */
router.delete('/:id', async (req, res) => {
  try {
    if (!isRedisReady()) {
      return res.json({ success: true, message: '删除成功（仅本地）' });
    }

    const userId = req.user.userId || req.user.id;
    const convId = req.params.id;
    const success = await conversationStore.deleteConversation(userId, convId);
    if (!success) {
      return res.status(404).json({ success: false, error: '会话不存在' });
    }
    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    console.error('删除会话失败:', error.message);
    res.json({ success: true, message: '删除成功（仅本地）' });
  }
});

/**
 * 清空会话消息
 */
router.delete('/:id/messages', async (req, res) => {
  try {
    if (!isRedisReady()) {
      return res.json({ success: true, message: '清空成功（仅本地）' });
    }

    const userId = req.user.userId || req.user.id;
    const convId = req.params.id;
    const success = await conversationStore.clearMessages(userId, convId);
    if (!success) {
      return res.status(404).json({ success: false, error: '会话不存在' });
    }
    res.json({ success: true, message: '清空成功' });
  } catch (error) {
    console.error('清空消息失败:', error.message);
    res.json({ success: true, message: '清空成功（仅本地）' });
  }
});

module.exports = router;
