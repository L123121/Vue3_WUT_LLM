/**
 * 路由注册 — 从 app.js 拆分
 */
const express = require('express');
const path = require('path');
const config = require('../config');

function applyRoutes(app, chatLimiter) {
  const { router: apiRoutes } = require('./index');
  const { streamHandler } = require('../controllers/chat.controller');
  const { speechHandler } = require('../controllers/audio.controller');
  const { chatUpload, parseFile } = require('../services/file-upload.service');
  const { requireAuth } = require('../middleware/auth.middleware');
  const { router: authRoutes } = require('./auth.routes');
  const { router: metricsRoutes } = require('./metrics.routes');

  const isProduction = process.env.NODE_ENV === 'production';

  // 健康检查
  app.get('/api/health', (req, res) => {
    const hasApiConfig = !!config.ai.apiKey;
    res.json({
      status: 'ok',
      message: '武理小精灵后端服务运行正常',
      timestamp: new Date().toISOString(),
      ai_service: {
        enabled: hasApiConfig,
        provider: 'StepFun (阶跃星辰)',
        model: config.ai.model || 'step-3.7-flash',
        status: hasApiConfig ? '配置正常' : '模拟模式',
      },
      storage: 'sqlite',
    });
  });

  // API 列表
  app.get('/api', (req, res) => {
    res.json({
      app: '武理小精灵后端',
      version: '1.0.0',
      endpoints: [
        { method: 'GET', path: '/api/health', description: '健康检查' },
        { method: 'GET', path: '/api', description: 'API列表' },
        { method: 'POST', path: '/api/stream', description: '流式聊天接口' },
        { method: 'POST', path: '/api/audio/speech', description: 'AI 回复语音合成' },
        { method: 'POST', path: '/api/auth/login', description: '登录' },
        { method: 'POST', path: '/api/auth/register', description: '注册' },
        { method: 'GET', path: '/api/auth/me', description: '当前用户' },
      ],
    });
  });

  // 认证路由
  app.use('/api/auth', authRoutes);

  // 指标路由
  app.use('/api/metrics', metricsRoutes);

  // 子路由（RAG、评测、工具、记忆）
  app.use('/api', apiRoutes);

  // SSE 流式聊天
  app.post('/api/stream', chatLimiter, streamHandler);

  // AI 回复语音合成（服务端代理，避免在浏览器暴露 StepFun API Key）
  app.post('/api/audio/speech', requireAuth, chatLimiter, speechHandler);

  // 聊天文件上传
  app.post('/api/chat/upload', requireAuth, chatUpload.single('file'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '请上传文件' });
    }

    try {
      const file = req.file;
      const originalName = fixFilenameEncoding(file.originalname);
      const isImage = file.mimetype.startsWith('image/');
      let textContent = null;

      // 文档与图片都尝试解析：图片走视觉模型识别（表格截图→Markdown），
      // 识别失败（OCR 未启用/网络异常）降级为 null，不阻塞上传
      try {
        textContent = await parseFile(file.path, originalName);
      } catch (e) {
        console.warn('[ChatUpload] 文件解析失败:', e.message);
      }

      if (textContent && Buffer.isBuffer(textContent)) {
        textContent = textContent.toString('utf8');
      }

      res.json({
        success: true,
        data: {
          url: `/uploads/${file.filename}`,
          name: originalName,
          type: file.mimetype,
          size: file.size,
          textContent,
          isImage,
        }
      });
    } catch (error) {
      console.error('[ChatUpload] 上传失败:', error);
      res.status(500).json({ success: false, error: '文件上传失败' });
    }
  });

  // 上传目录静态资源（仅登录用户可访问，防止文件 URL 泄露后匿名下载）
  const uploadStaticDir = path.join(__dirname, '../../uploads');
  const inlineImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
  app.use('/uploads', requireAuth, express.static(uploadStaticDir, {
    setHeaders: (res, filePath) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (!inlineImageExtensions.has(path.extname(filePath).toLowerCase())) {
        res.setHeader('Content-Disposition', 'attachment');
      }
    },
  }));

  // 生产环境托管前端
  if (isProduction) {
    const frontendDist = path.join(__dirname, '../../../dist');
    app.use(express.static(frontendDist));

    app.get('*', (req, res) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return;

      // 禁止浏览器缓存 index.html，确保每次加载最新前端（配合 hash 资源文件）
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }
}

/**
 * 修复 multer 可能将 UTF-8 文件名误读为 Latin-1 的编码问题
 */
function fixFilenameEncoding(name) {
  if (!name) return name;
  try {
    const reencoded = Buffer.from(name, 'latin1').toString('utf8');
    const origChinese = (name.match(/[\u00c0-\u00ff]/g) || []).length;
    const fixedChinese = (reencoded.match(/[\u4e00-\u9fff]/g) || []).length;
    if (fixedChinese > origChinese) {
      return reencoded;
    }
  } catch (err) {
    console.warn('[FileUpload] 文件名编码修复失败:', err.message);
  }
  return name;
}

module.exports = { applyRoutes };
