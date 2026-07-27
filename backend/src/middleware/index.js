/**
 * 中间件注册 — 从 app.js 拆分
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { createTraceId, logEvent, sanitizeTraceId } = require('../services/observability.service');

function applyMiddleware(app) {
  const isProduction = process.env.NODE_ENV === 'production';

  app.use((req, res, next) => {
    const incomingTraceId = req.get('x-trace-id') || req.get('x-request-id');
    const traceId = sanitizeTraceId(incomingTraceId) || createTraceId('req');
    req.traceId = traceId;
    res.locals.traceId = traceId;
    res.setHeader('X-Trace-Id', traceId);

    const startedAt = Date.now();
    res.on('finish', () => {
      if (process.env.HTTP_TRACE_LOGS === 'false') return;
      logEvent('info', 'http_request', {
        traceId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        userId: req.userId || null,
      });
    });

    next();
  });

  // CORS — 允许前端跨域 + cookie
  // 生产环境必须显式配置 CORS_ORIGIN 白名单，缺失时 fail-fast 而非回退到 origin:true，
  // 否则任意第三方站点可携带 httpOnly cookie 发起跨域请求（CSRF 式凭证泄露）
  let corsOrigin;
  if (isProduction) {
    const origin = process.env.CORS_ORIGIN;
    if (!origin) {
      console.error('[CORS] 生产环境未配置 CORS_ORIGIN，拒绝启动。请在环境变量中设置允许的前端域名。');
      process.exit(1);
    }
    corsOrigin = origin.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    corsOrigin = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  }
  app.use(cors({
    origin: corsOrigin,
    credentials: true,
  }));

  // Cookie 解析（JWT httpOnly cookie 必需）
  app.use(cookieParser());

  // 安全头 + CSP
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        connectSrc: ["'self'", "ws:", "wss:"],
        frameSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrcAttr: ["'none'"],
      },
    },
  }));

  morgan.token('traceId', req => req.traceId || '-');
  const logFormat = isProduction
    ? ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" traceId=:traceId'
    : ':method :url :status :response-time ms traceId=:traceId';
  app.use(morgan(logFormat));

  // 请求体解析
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // JWT 鉴权中间件（从 cookie 读取 token）
  const { authMiddleware } = require('../middleware/auth.middleware');
  app.use(authMiddleware);

  // 用户级配额中间件
  const { quotaMiddleware } = require('../middleware/quota.middleware');
  app.use(quotaMiddleware);

  // 聊天接口速率限制
  const chatLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 60,
    message: { success: false, error: '请求过于频繁，请稍后再试' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  return chatLimiter;
}

module.exports = { applyMiddleware };



