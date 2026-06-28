"use strict";

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');

function createMemoryRoutes(memoryService) {
  const router = Router();

  // 记忆接口需要登录
  router.use(requireAuth);

  /**
   * GET /api/memory — 获取用户所有记忆
   */
  router.get('/', async (req, res) => {
    const userId = req.userId;
    try {
      const [shortTerm, longTerm, profile, stats] = await Promise.all([
        memoryService.getShortTerm(userId),
        memoryService.getLongTerm(userId),
        memoryService.getProfile(userId),
        memoryService.getStats(userId),
      ]);

      res.json({
        success: true,
        data: { shortTerm, longTerm, profile, stats },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/memory/stats — 获取记忆统计
   */
  router.get('/stats', async (req, res) => {
    const userId = req.userId;
    try {
      const stats = await memoryService.getStats(userId);
      res.json({ success: true, data: stats });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/memory/long-term — 获取长期记忆
   */
  router.get('/long-term', async (req, res) => {
    const userId = req.userId;
    const { query } = req.query;
    try {
      const memories = await memoryService.getLongTerm(userId, query);
      res.json({ success: true, data: memories });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/memory/long-term — 添加长期记忆
   */
  router.post('/long-term', async (req, res) => {
    const userId = req.userId;
    const { type, content, source } = req.body;
    if (!content) {
      return res.status(400).json({ success: false, error: '记忆内容不能为空' });
    }
    try {
      const entry = await memoryService.addLongTerm(userId, { type, content, source });
      res.json({ success: true, data: entry });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * DELETE /api/memory/long-term/:id — 删除长期记忆
   */
  router.delete('/long-term/:id', async (req, res) => {
    const userId = req.userId;
    try {
      await memoryService.removeLongTerm(userId, req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/memory/profile — 更新用户画像
   */
  router.put('/profile', async (req, res) => {
    const userId = req.userId;
    try {
      await memoryService.updateProfile(userId, req.body);
      const profile = await memoryService.getProfile(userId);
      res.json({ success: true, data: profile });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * DELETE /api/memory — 清空所有记忆
   */
  router.delete('/', async (req, res) => {
    const userId = req.userId;
    try {
      await Promise.all([
        memoryService.clearShortTerm(userId),
        memoryService.clearLongTerm(userId),
      ]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createMemoryRoutes };
