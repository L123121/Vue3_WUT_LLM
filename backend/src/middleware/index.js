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

function applyMiddleware(app) {
  const isProduction = process.env.NODE_ENV === 'production';

  // CORS — 允许前端跨域 + cookie
  app.use(cors({
    origin: isProduction
      ? process.env.CORS_ORIGIN || true
      : ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  }));

  // Cookie 解析（JWT httpOnly cookie 必需）
  app.use(cookieParser());

  // 安全头 + CSP
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        frameSrc: ["'none'"],
      },
    },
  }));

  // 请求日志
  app.use(morgan(isProduction ? 'combined' : 'dev'));

  // 请求体解析
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // JWT 鉴权中间件（从 cookie 读取 token）
  const { authMiddleware } = require('../middleware/auth.middleware');
  app.use(authMiddleware);

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
