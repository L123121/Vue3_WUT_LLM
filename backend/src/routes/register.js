/**
 * 路由注册 — 从 app.js 拆分
 */
const express = require('express');
const path = require('path');
const config = require('../config');

function applyRoutes(app, chatLimiter) {
  const { router: apiRoutes, memoryService } = require('./index');
  const { chatHandler, streamHandler } = require('../controllers/chat.controller');
  const { chatUpload, parseFile, cleanupFile } = require('../services/file-upload.service');
  const { COOKIE_NAME } = require('../middleware/auth.middleware');

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
        model: config.ai.model || 'Qwen3.6-35B-A3B',
        status: hasApiConfig ? '配置正常' : '模拟模式',
      },
      storage: 'memory',
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
        { method: 'GET', path: '/api/usage', description: '已弃用' },
        { method: 'POST', path: '/api', description: '聊天接口（非流式）' },
        { method: 'POST', path: '/api/stream', description: '流式聊天接口' },
      ],
    });
  });

  app.get('/api/usage', (req, res) => {
    res.json({ success: true, data: { summary: { totalTokens: 0, estimatedCost: 0 } } });
  });

  // 聊天接口
  app.post('/api', chatLimiter, chatHandler);
  app.post('/api/chat', chatLimiter, chatHandler);

  // 子路由（RAG、学校、评测、工具、记忆）
  app.use('/api', apiRoutes);

  // SSE 流式聊天
  app.post('/api/stream', chatLimiter, streamHandler);

  // 登出接口 — 清除 httpOnly cookie
  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
    res.json({ success: true, message: '已退出登录' });
  });

  // 聊天文件上传
  app.post('/api/chat/upload', chatUpload.single('file'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '请上传文件' });
    }

    try {
      const file = req.file;
      const originalName = fixFilenameEncoding(file.originalname);
      const isImage = file.mimetype.startsWith('image/');
      let textContent = null;

      if (!isImage) {
        try {
          textContent = await parseFile(file.path, originalName);
        } catch (e) {
          console.warn('[ChatUpload] 文件解析失败:', e.message);
        }
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

  // 上传目录对外可访问
  app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

  // 生产环境托管前端
  if (isProduction) {
    const frontendDist = path.join(__dirname, '../../dist');
    app.use(express.static(frontendDist));
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
        res.sendFile(path.join(frontendDist, 'index.html'));
      }
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
    const origChinese = (name.match(/[ÿ-￿]/g) || []).length;
    const fixedChinese = (reencoded.match(/[一-鿿]/g) || []).length;
    if (fixedChinese > origChinese) {
      return reencoded;
    }
  } catch (err) {
    console.warn('[FileUpload] 文件名编码修复失败:', err.message);
  }
  return name;
}

module.exports = { applyRoutes };
