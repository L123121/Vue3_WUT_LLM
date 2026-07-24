require('dotenv').config();
const express = require('express');
const config = require('./config');
// 环境变量校验已在 config/index.js 中统一处理，此处不再重复

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
  console.log(`[Server] AI Model: ${config.ai.model || 'step-3.7-flash'}`);
  console.log(`[Server] Mode: ${hasApi ? 'online' : 'mock'}`);
  console.log('[Server] Storage: SQLite (data/store.json)');
  console.log('[Server] RAG Provider: Milvus (dense + sparse hybrid)');
  console.log('='.repeat(60));
});
