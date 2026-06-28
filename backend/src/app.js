require('dotenv').config();
const express = require('express');
const config = require('./config');

// 验证必要环境变量
if (!process.env.VITEST) {
  const requiredEnv = ['AI_API_KEY', 'JWT_SECRET', 'SCHOOL_ENC_KEY'];
  const missing = requiredEnv.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error(`[Config] 缺少必要环境变量: ${missing.join(', ')}`);
    console.error('[Config] 请检查 backend/.env 文件配置');
    process.exit(1);
  }
}

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// 中间件 + 速率限制
const { applyMiddleware } = require('./middleware');
const chatLimiter = applyMiddleware(app);

// 路由注册
const { applyRoutes } = require('./routes/register');
applyRoutes(app, chatLimiter);

// 404 处理
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: '接口不存在',
    path: req.originalUrl,
  });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err);
  const statusCode = err.statusCode || err.status || 500;
  const message = statusCode >= 500 ? '服务器内部错误' : (err.message || '请求处理失败');
  res.status(statusCode).json({
    success: false,
    error: message,
    ...(statusCode >= 500 ? {} : { details: err.message }),
  });
});

// 启动
app.listen(PORT, '0.0.0.0', async () => {
  const hasApi = !!config.ai.apiKey;
  console.log('='.repeat(60));
  console.log('[Server] Backend started successfully.');
  console.log(`[Server] URL: http://localhost:${PORT}`);
  console.log(`[Server] AI Model: ${config.ai.model || 'Qwen3.6-35B-A3B'}`);
  console.log(`[Server] Mode: ${hasApi ? 'online' : 'mock'}`);
  console.log('[Server] Storage: local file (data/store.json)');
  console.log('[Server] RAG Provider: chatdoc.xfyun.cn');
  console.log('='.repeat(60));
});
