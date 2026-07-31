"use strict";

const quotaService = require("../services/quota.service");

/**
 * 用户级配额中间件
 * 在请求处理前检查配额，超限时返回 429
 * 在请求处理后递增配额（通过 res.on("finish") 确保只对成功请求计数）
 */
function quotaMiddleware(req, res, next) {
  // 仅对需要消耗 LLM 配额的路由启用
  // 在白名单中的路径跳过配额检查
  const skipPaths = [
    "/api/health", "/api",
    "/api/auth/login", "/api/auth/register", "/api/auth/logout", "/api/auth/me",
    "/api/metrics",
    "/api/rag/stats", "/api/rag/documents",
    "/api/memory",
  ];
  if (skipPaths.some(p => req.path === p || req.path.startsWith(p + "/"))) {
    return next();
  }

  // SPA 首页和静态资源跳过（不消耗 LLM 配额）
  if (req.path === "/") return next();
  if (req.path.startsWith("/assets/")) return next();
  if (req.path.startsWith("/uploads/")) return next();

  quotaService.check(req.userId).then(function(result) {
    if (!result.ok) {
      return res.status(429).json({
        success: false,
        error: "今日配额已用完，请明天再试",
        quota: result.usage,
      });
    }

    // 请求成功后递增配额
    res.on("finish", function() {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        quotaService.increment(req.userId).catch(function() {});
      }
    });

    next();
  }).catch(function(err) {
    console.error("[Quota] 检查失败:", err.message);
    next(); // 配额系统故障时不阻塞请求
  });
}

module.exports = { quotaMiddleware };
