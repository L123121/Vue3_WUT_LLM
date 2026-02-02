// config.ts
import dotenv from 'dotenv';
dotenv.config();

export default {
  xunfei: {
    // 从环境变量或调用信息文档获取
    apiKey: process.env.XUNFEI_API_KEY || 'a8857c7cb2aa4d80c9ce33f202577974:NDk1YjUxNTA2MGYxM2E2YzY5M2Y1OTI5',
    
    // 接口地址
    baseUrl: process.env.XUNFEI_BASE_URL || 'https://maas-api.cn-huabei-1.xf-yun.com/v2',
    
    // 服务名称
    serviceName: process.env.XUNFEI_SERVICE_NAME || 'Chatljj',

    // WebSocket 配置
    wsUrl: process.env.XUNFEI_WS_URL || 'wss://maas-api.cn-huabei-1.xf-yun.com/v1.1/chat',
    appId: process.env.XUNFEI_APP_ID || '',
    domain: process.env.XUNFEI_WS_DOMAIN || 'general',
    patchId: process.env.XUNFEI_RESOURCE_ID || '',
    apiKeyWs: process.env.XUNFEI_API_KEY_WS || '',
    apiSecretWs: process.env.XUNFEI_API_SECRET_WS || '',

    // 模型名称
    model: process.env.XUNFEI_MODEL || 'Qwen3-1.7B',
    temperature: 0.7,
    maxTokens: 1024,
    timeout: 30000
  }
};