// config.js
require('dotenv').config();

module.exports = {
  // Anthropic API 配置（主模型）
  anthropic: {
    authToken: process.env.ANTHROPIC_AUTH_TOKEN || '',
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/anthropic',
    model: 'mimo-v2.5',
    maxTokens: 4000,
    temperature: 0.7,
    timeout: 60000
  },
  // 讯飞配置（保留用于 Embedding 等）
  xunfei: {
    apiKey: process.env.XUNFEI_API_KEY || '',
    appId: process.env.XUNFEI_APP_ID || '',
  },
  // Embedding 配置
  embedding: {
    host: process.env.XUNFEI_EMBEDDING_HOST || 'maas-api.cn-huabei-1.xf-yun.com',
    path: '/v2/embeddings',
    model: process.env.XUNFEI_EMBEDDING_MODEL || 'emb-text-001'
  }
};
