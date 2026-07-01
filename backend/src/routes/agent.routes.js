"use strict";

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { getRecentTraces } = require('../services/agent-tracer');

function createAgentRoutes() {
  const router = Router();

  // agent 运维接口需要登录
  router.use(requireAuth);

  /**
   * GET /api/agent/traces?limit=20 — 读取当前用户最近的 Agent 运行轨迹
   *
   * 返回结构化轨迹摘要（路由、迭代步数、工具调用、总耗时、最终状态），
   * 供前端调试面板或运维排查使用。仅返回调用者本人的轨迹。
   */
  router.get('/traces', async (req, res) => {
    const userId = req.userId;
    const rawLimit = parseInt(req.query.limit, 10);
    // limit ∈ [1, 50]，默认 20
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 20;

    try {
      const traces = await getRecentTraces(userId, limit);
      res.json({ success: true, data: traces });
    } catch (err) {
      console.error('[AgentRoutes] 读取轨迹失败:', err);
      res.status(500).json({ success: false, error: '读取轨迹失败' });
    }
  });

  return router;
}

module.exports = { createAgentRoutes };
