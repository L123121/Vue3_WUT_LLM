const jwt = require('jsonwebtoken');
const config = require('../config');

const COOKIE_NAME = 'auth_token';

/**
 * JWT 鉴权中间件
 * 从 httpOnly cookie 中提取 token，验证后注入 req.userId
 * 如果没有 token，不报错，只是 req.userId 为 null（允许匿名访问部分接口）
 */
const authMiddleware = (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAME];

  if (!token) {
    req.userId = null;
    req.username = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.userId = decoded.userId || decoded.id || null;
    req.username = decoded.username || null;
  } catch (err) {
    // Token 无效或过期，清除坏 cookie（secure 标志需与设置时一致）
    const isProd = process.env.NODE_ENV === 'production';
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/' });
    req.userId = null;
    req.username = null;
  }

  next();
};

/**
 * 强制鉴权中间件 — 必须有有效 token
 */
const requireAuth = (req, res, next) => {
  if (!req.userId) {
    return res.status(401).json({
      success: false,
      message: '请先登录',
    });
  }
  next();
};

/**
 * 生成 JWT token
 */
const generateToken = (payload) => {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
};

module.exports = { authMiddleware, requireAuth, generateToken, COOKIE_NAME };
