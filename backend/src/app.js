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
const server = app.listen(PORT, '0.0.0.0', async () => {
  const hasApi = !!config.ai.apiKey;
  const dbType = process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite';
  console.log('='.repeat(60));
  console.log('[Server] Backend started successfully.');
  console.log(`[Server] URL: http://localhost:${PORT}`);
  console.log(`[Server] AI Model: ${config.ai.model || 'step-3.7-flash'}`);
  console.log(`[Server] Mode: ${hasApi ? 'online' : 'mock'}`);
  console.log(`[Server] Storage: ${dbType}`);
  console.log('[Server] Vector: 本地文件持久化（精确检索）');
  console.log('='.repeat(60));

  // 启动时初始化向量库：注册 documentProvider + 重建索引
  // 修复延迟初始化 bug：DocumentService.indexingService 是懒加载，
  // 如果没人调用索引方法，registerDocumentProvider 永远不触发，向量为空。
  // 这里主动触发一次，确保启动后向量库就绪。
  try {
    const { DocumentService } = require('./services/document.service');
    const { vectorStore } = require('./services/vector-store.service');
    const docService = new DocumentService();
    // 触发 indexingService getter → 注册 provider
    // 然后 ensureReady 会从文档库重建向量
    docService.indexingService; // 触发 provider 注册
    await vectorStore.ensureReady();
    console.log(`[Server] 向量库初始化完成，共 ${vectorStore._docs.length} 条向量`);
  } catch (err) {
    console.warn(`[Server] 向量库初始化失败（不影响启动）: ${err.message}`);
  }
});

// 优雅关闭：先停向量库保存，再关 server
async function shutdown(signal) {
  console.log(`[Server] 收到 ${signal}，正在优雅关闭...`);
  try {
    const { vectorStore } = require('./services/vector-store.service');
    if (vectorStore._dirty) vectorStore._saveSync();
  } catch (_) {}
  server.close(() => {
    console.log('[Server] HTTP server 已关闭');
    process.exit(0);
  });
  // 兜底：5s 后强制退出
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
