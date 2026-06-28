const { Router } = require('express');

const { requireAuth } = require('../middleware/auth.middleware');
const { conversationStore } = require('../services/memory-store');

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const conversations = await conversationStore.getConversations(req.userId);
    res.json({ success: true, data: conversations });
  } catch (error) {
    console.error('获取会话列表失败:', error.message);
    res.status(500).json({ success: false, error: '获取会话列表失败' });
  }
});

router.post('/', async (req, res) => {
  try {
    const conversation = await conversationStore.createConversation(
      req.userId,
      req.body.title
    );
    res.json({ success: true, data: conversation });
  } catch (error) {
    console.error('创建会话失败:', error.message);
    res.status(500).json({ success: false, error: '创建会话失败' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const conversation = await conversationStore.getConversation(
      req.userId,
      req.params.id
    );

    if (!conversation) {
      return res.status(404).json({ success: false, error: '会话不存在' });
    }

    res.json({ success: true, data: conversation });
  } catch (error) {
    console.error('获取会话详情失败:', error.message);
    res.status(500).json({ success: false, error: '获取会话详情失败' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { title, messages } = req.body;
    if (title === undefined && messages === undefined) {
      return res.status(400).json({ success: false, error: '缺少更新内容' });
    }

    if (title !== undefined && !String(title).trim()) {
      return res.status(400).json({ success: false, error: '标题不能为空' });
    }

    if (messages !== undefined && !Array.isArray(messages)) {
      return res.status(400).json({ success: false, error: '消息格式不正确' });
    }

    const conversation = await conversationStore.saveConversation(req.userId, req.params.id, {
      ...(title !== undefined ? { title } : {}),
      ...(messages !== undefined ? { messages } : {}),
    });

    if (!conversation) {
      return res.status(404).json({ success: false, error: '会话不存在' });
    }

    res.json({ success: true, data: conversation });
  } catch (error) {
    console.error('更新会话失败:', error.message);
    res.status(500).json({ success: false, error: '更新会话失败' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const success = await conversationStore.deleteConversation(req.userId, req.params.id);
    if (!success) {
      return res.status(404).json({ success: false, error: '会话不存在' });
    }

    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    console.error('删除会话失败:', error.message);
    res.status(500).json({ success: false, error: '删除会话失败' });
  }
});

router.delete('/:id/messages', async (req, res) => {
  try {
    const success = await conversationStore.clearMessages(req.userId, req.params.id);
    if (!success) {
      return res.status(404).json({ success: false, error: '会话不存在' });
    }

    res.json({ success: true, message: '清空成功' });
  } catch (error) {
    console.error('清空消息失败:', error.message);
    res.status(500).json({ success: false, error: '清空消息失败' });
  }
});

module.exports = router;
