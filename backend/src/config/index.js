// config.js
require('dotenv').config();

if (!process.env.VITEST) {
  const requiredEnv = ['AI_API_KEY', 'JWT_SECRET', 'SCHOOL_ENC_KEY'];
  const missing = requiredEnv.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error(`[Config] 缺少必要环境变量: ${missing.join(', ')}`);
    console.error('[Config] 请检查 backend/.env 文件配置');
    process.exit(1);
  }
}

module.exports = {
  // AI 模型服务（OpenAI-compatible API）
  ai: {
    apiKey: process.env.AI_API_KEY,
    baseUrl: process.env.AI_BASE_URL || 'https://api.stepfun.com/v1',
    model: process.env.AI_MODEL || 'step-3.7-flash',
    maxTokens: 4000,
    temperature: 0.7,
    timeout: 60000,
  },
  // 讯飞配置（保留用于 Embedding / 星火知识库）
  xunfei: {
    apiKey: process.env.XUNFEI_API_KEY || '',
    appId: process.env.XUNFEI_APP_ID || '',
  },
  // Embedding 配置
  embedding: {
    host: process.env.XUNFEI_EMBEDDING_HOST || 'maas-api.cn-huabei-1.xf-yun.com',
    path: '/v2/embeddings',
    model: process.env.XUNFEI_EMBEDDING_MODEL || 'emb-text-001',
  },
  // JWT 配置（必须通过环境变量设置，禁止硬编码默认值）
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: '7d',
  },
  // 学校教务系统配置
  school: {
    tpHost: process.env.SCHOOL_TP_HOST || 'https://one.whut.edu.cn',
    jwHost: process.env.SCHOOL_JW_HOST || 'https://jwxt.whut.edu.cn',
    encKey: process.env.SCHOOL_ENC_KEY,
    sessionTTL: 2 * 60 * 60 * 1000, // 2 小时
    browserDebugPort: parseInt(process.env.SCHOOL_BROWSER_DEBUG_PORT) || 9222,
  },
};
