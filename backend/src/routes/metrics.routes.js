/**
 * 指标路由 — Web Vitals 上报与查询（需管理员权限）
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { operationalMetrics } = require('../services/operational-metrics.service');

const router = express.Router();

// 内存存储（轻量，重启清空）
const webVitalsStore = [];
const MAX_WEB_VITALS = 1000;

// POST /api/metrics/web-vitals — 前端上报
router.post('/web-vitals', (req, res) => {
  const metric = req.body;
  if (!metric || !metric.name || metric.value === undefined) {
    return res.status(400).json({ success: false, error: '无效的指标数据' });
  }

  metric.serverTimestamp = new Date().toISOString();
  webVitalsStore.push(metric);
  if (webVitalsStore.length > MAX_WEB_VITALS) {
    webVitalsStore.splice(0, webVitalsStore.length - MAX_WEB_VITALS);
  }

  res.json({ success: true });
});

// GET /api/metrics/web-vitals — 查看（需登录 + 管理员）
router.get('/web-vitals', requireAuth, (req, res) => {
  if (req.role !== 'admin') {
    return res.status(403).json({ success: false, error: '需要管理员权限' });
  }

  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const recent = webVitalsStore.slice(-limit).reverse();

  // 聚合统计
  const stats = {};
  for (const m of recent) {
    if (!stats[m.name]) stats[m.name] = { values: [], ratings: { good: 0, 'needs-improvement': 0, poor: 0 } };
    stats[m.name].values.push(m.value);
    if (m.rating) stats[m.name].ratings[m.rating] = (stats[m.name].ratings[m.rating] || 0) + 1;
  }

  const averages = {};
  for (const [name, data] of Object.entries(stats)) {
    const values = data.values.filter(v => v < 99999);
    averages[name] = {
      avg: values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0,
      min: values.length > 0 ? Math.min(...values) : 0,
      max: values.length > 0 ? Math.max(...values) : 0,
      count: values.length,
      ratings: data.ratings,
    };
  }

  res.json({
    success: true,
    data: { total: webVitalsStore.length, recent, averages },
  });
});

router.get('/operations', requireAuth, (req, res) => {
  if (req.role !== 'admin') return res.status(403).json({ success: false, error: '需要管理员权限' });
  res.json({ success: true, data: operationalMetrics.snapshot() });
});

module.exports = { router };
