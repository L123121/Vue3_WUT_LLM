require('dotenv').config();
const express = require('express');
const config = require('./config');
const { operationalMetrics } = require('./services/operational-metrics.service');
const { initTracing, shutdownTracing } = require('./services/otel-tracing.service');
// 环境变量校验已在 config/index.js 中统一处理，此处不再重复

// OTel traces（OTLP 导出）：OTEL_EXPORTER_OTLP_ENDPOINT 未设置时为 Noop（不加载 SDK）
initTracing();

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
app.use((err, req, res, _next) => {
  operationalMetrics.recordError(err, { traceId: req.traceId, method: req.method, path: req.path, userId: req.userId || null });
  console.error('[Server] Unhandled error:', err);
  const statusCode = err.statusCode || err.status || 500;
  const message = statusCode >= 500 && err.expose !== true
    ? '服务器内部错误'
    : (err.message || '请求处理失败');
  res.status(statusCode).json({
    success: false,
    error: message,
    ...(err.code ? { code: err.code } : {}),
    ...(statusCode >= 500 ? {} : { details: err.message }),
  });
});

// 启动
const server = app.listen(PORT, '0.0.0.0', async () => {
  const hasApi = !!config.ai.apiKey;
  console.log('='.repeat(60));
  console.log('[Server] Backend started successfully.');
  console.log(`[Server] URL: http://localhost:${PORT}`);
  console.log(`[Server] AI Model: ${config.ai.model || 'step-3.7-flash'}`);
  console.log(`[Server] Mode: ${hasApi ? 'online' : 'mock'}`);
  console.log('[Server] Storage: SQLite（store.db，WAL）');
  console.log('[Server] Vector: 本地文件持久化（精确检索）');
  console.log('='.repeat(60));

  // 启动时初始化向量库：注册 documentProvider + 重建索引
  // 修复延迟初始化 bug：DocumentService.indexingService 是懒加载，
  // 如果没人调用索引方法，registerDocumentProvider 永远不触发，向量为空。
  // 这里主动触发一次，确保启动后向量库就绪。
  try {
    const { DocumentService } = require('./services/document.service');
    const { vectorStore } = require('./services/vector-store-qdrant.service');
    const docService = new DocumentService();
    // 触发 indexingService getter → 注册 provider
    // 然后 ensureReady 会从文档库重建向量
    docService.indexingService; // 触发 provider 注册
    await vectorStore.ensureReady();
    const vectorCount = await vectorStore.count();
    console.log(`[Server] 向量库初始化完成，共 ${vectorCount} 条向量`);
  } catch (err) {
    console.warn(`[Server] 向量库初始化失败（不影响启动）: ${err.message}`);
  }

  // 上传目录定期清理（聊天上传孤儿文件，7 天过期）
  try {
    const { startUploadsCleanup } = require('./services/file-upload.service');
    startUploadsCleanup();
  } catch (err) {
    console.warn(`[Server] 上传目录清理任务启动失败: ${err.message}`);
  }
});

// 优雅关闭：先停向量库保存，再关 server
let isShuttingDown = false;
async function shutdown(signal, exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Server] 收到 ${signal}，正在优雅关闭...`);
  try {
    const { vectorStore } = require('./services/vector-store-qdrant.service');
    vectorStore.flush();
  } catch (error) {
    console.warn('[Server] 向量数据落盘失败:', error.message);
  }
  operationalMetrics.flush();
  await shutdownTracing();
  server.close(() => {
    operationalMetrics.close();
    console.log('[Server] HTTP server 已关闭');
    process.exit(exitCode);
  });
  // 兜底：5s 后强制退出
  setTimeout(() => process.exit(exitCode), 5000).unref();
}

if (!process.env.VITEST) {
  process.on('unhandledRejection', (reason) => {
    console.error('[Server] 未处理的 Promise rejection:', reason instanceof Error ? reason.stack || reason.message : reason);
    void shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (err) => {
    console.error('[Server] 未捕获异常，进程将退出:', err.stack || err);
    void shutdown('uncaughtException', 1);
  });
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
