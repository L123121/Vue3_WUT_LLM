"use strict";

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');

function createToolRoutes(toolRegistry) {
  const router = Router();

  // 工具接口需要登录
  router.use(requireAuth);

  /**
   * GET /api/tools — 列出所有工具
   */
  router.get('/', (req, res) => {
    const { source, category, enabled } = req.query;

    let tools = toolRegistry.getAllTools();

    if (source) {
      tools = tools.filter(t => t.source === source);
    }
    if (category) {
      tools = tools.filter(t => t.category === category);
    }
    if (enabled !== undefined) {
      const isEnabled = enabled === 'true';
      tools = tools.filter(t => t.enabled === isEnabled);
    }

    res.json({
      success: true,
      data: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        category: t.category,
        source: t.source,
        enabled: t.enabled,
        registeredAt: t.registeredAt,
      })),
      stats: toolRegistry.getStats(),
    });
  });

  /**
   * GET /api/tools/stats — 获取统计信息
   */
  router.get('/stats', (req, res) => {
    res.json({ success: true, data: toolRegistry.getStats() });
  });

  /**
   * GET /api/tools/:name — 获取单个工具详情
   */
  router.get('/:name', (req, res) => {
    const tool = toolRegistry.getTool(req.params.name);
    if (!tool) {
      return res.status(404).json({ success: false, error: `工具 ${req.params.name} 不存在` });
    }
    res.json({
      success: true,
      data: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        category: tool.category,
        source: tool.source,
        enabled: tool.enabled,
        registeredAt: tool.registeredAt,
      },
    });
  });

  /**
   * PUT /api/tools/:name/toggle — 切换工具启用/禁用
   */
  router.put('/:name/toggle', (req, res) => {
    const tool = toolRegistry.getTool(req.params.name);
    if (!tool) {
      return res.status(404).json({ success: false, error: `工具 ${req.params.name} 不存在` });
    }
    toolRegistry.setEnabled(req.params.name, !tool.enabled);
    const updated = toolRegistry.getTool(req.params.name);
    res.json({
      success: true,
      data: { name: updated.name, enabled: updated.enabled },
    });
  });

  /**
   * DELETE /api/tools/:name — 移除工具
   */
  router.delete('/:name', (req, res) => {
    const tool = toolRegistry.getTool(req.params.name);
    if (!tool) {
      return res.status(404).json({ success: false, error: `工具 ${req.params.name} 不存在` });
    }
    if (tool.source === 'builtin') {
      return res.status(400).json({ success: false, error: '内置工具不可删除' });
    }
    toolRegistry.unregister(req.params.name);
    res.json({ success: true, message: `工具 ${req.params.name} 已移除` });
  });

  /**
   * POST /api/tools/execute — 手动执行工具（调试用）
   */
  router.post('/execute', async (req, res) => {
    const { name, args = {}, context = {} } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: '缺少工具名称' });
    }
    const result = await toolRegistry.executeTool(name, args, context);
    res.json({ success: true, data: { name, result } });
  });

  return router;
}

module.exports = { createToolRoutes };
