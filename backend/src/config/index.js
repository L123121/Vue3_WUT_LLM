// config.js
require('dotenv').config();

module.exports = {
  xunfei: {
    // API Key 格式: "APIKey:APISecret"
    apiKey: process.env.XUNFEI_API_KEY || '',
    // 接口地址
    baseUrl: process.env.XUNFEI_BASE_URL || 'https://maas-api.cn-huabei-1.xf-yun.com/v2',
    // 模型名称
    model: process.env.XUNFEI_MODEL || 'xop3qwen1b7',
    // 服务名称
    serviceName: process.env.XUNFEI_SERVICE_NAME || 'Chatwut',
    temperature: 0.7,
    maxTokens: 4000,
    timeout: 60000
  },
  // Chroma 向量数据库配置
  chroma: {
    host: process.env.CHROMA_HOST || 'http://localhost:8000'
  },
  // Embedding 配置
  embedding: {
    host: process.env.XUNFEI_EMBEDDING_HOST || 'maas-api.cn-huabei-1.xf-yun.com',
    path: process.env.XUNFEI_EMBEDDING_PATH || '/v2/embeddings',
    model: process.env.XUNFEI_EMBEDDING_MODEL || 'emb-text-001'
  }
};
