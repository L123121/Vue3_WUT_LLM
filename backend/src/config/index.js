// config.js
require('dotenv').config();
const path = require('path');

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
  // LLM-as-judge 评测专用（独立 Key，不跟生产抢配额）
  judge: {
    apiKey: process.env.JUDGE_API_KEY || process.env.AI_API_KEY,
    baseUrl: process.env.AI_BASE_URL || 'https://api.stepfun.com/v1',
    model: process.env.JUDGE_MODEL || 'step-3.5-flash',
    maxTokens: 256,
    temperature: 0,
    timeout: 15000,
  },
  // 讯飞配置（可选，保留用于星火相关能力）
  xunfei: {
    apiKey: process.env.XUNFEI_API_KEY || '',
    appId: process.env.XUNFEI_APP_ID || '',
  },
  // Embedding 配置（本地 BGE-small-zh dense + n-gram sparse）
  embedding: {
    model: process.env.EMBEDDING_MODEL || 'Xenova/bge-small-zh-v1.5',
    cacheDir: process.env.EMBEDDING_CACHE_DIR || path.resolve(__dirname, '../../../.model-cache'),
    localFilesOnly: process.env.EMBEDDING_LOCAL_FILES_ONLY !== 'false',
    sparseDim: parseInt(process.env.EMBEDDING_SPARSE_DIM || process.env.XUNFEI_EMBEDDING_SPARSE_DIM, 10) || 250002,
  },
  // JWT 配置（必须通过环境变量设置，禁止硬编码默认值）
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: '7d',
  },
  // 向量数据库（Milvus / Milvus Lite，dense + sparse 混合检索）
  vectorStore: {
    backend: process.env.VECTOR_STORE_BACKEND || 'milvus',
    milvusAddress: process.env.MILVUS_ADDRESS || process.env.MILVUS_URI || 'localhost:19530',
    milvusToken: process.env.MILVUS_TOKEN || '',
    collectionName: process.env.MILVUS_COLLECTION || process.env.CHROMA_COLLECTION || 'wuli_elf_chunks',
    denseField: process.env.MILVUS_DENSE_FIELD || 'dense_vector',
    sparseField: process.env.MILVUS_SPARSE_FIELD || 'sparse_vector',
    vectorWeight: Number.parseFloat(process.env.MILVUS_DENSE_WEIGHT || process.env.RAG_VECTOR_WEIGHT || '0.6'),
    sparseWeight: Number.parseFloat(process.env.MILVUS_SPARSE_WEIGHT || process.env.RAG_SPARSE_WEIGHT || '0.4'),
  },
  // RAG 检索链路配置
  rag: {
    hybridSearchEnabled: process.env.RAG_HYBRID_SEARCH !== 'false',
    searchTopK: parseInt(process.env.RAG_VECTOR_TOP_K, 10) || 50,
    keywordTopK: parseInt(process.env.RAG_KEYWORD_TOP_K, 10) || 20,
    rerankTopK: parseInt(process.env.RAG_RERANK_TOP_K, 10) || 10,
    maxContextLength: parseInt(process.env.RAG_MAX_CONTEXT_LENGTH, 10) || 6000,
    minSourceScore: Number.parseFloat(process.env.RAG_MIN_SOURCE_SCORE || '0.03'),
    vectorWeight: Number.parseFloat(process.env.RAG_VECTOR_WEIGHT || '0.6'),
    keywordWeight: Number.parseFloat(process.env.RAG_KEYWORD_WEIGHT || '0.4'),
    rrfK: parseInt(process.env.RAG_RRF_K, 10) || 60,
  },
  // 学校教务系统配置
  school: {
    tpHost: process.env.SCHOOL_TP_HOST || 'https://one.whut.edu.cn',
    jwHost: process.env.SCHOOL_JW_HOST || 'https://jwxt.whut.edu.cn',
    encKey: process.env.SCHOOL_ENC_KEY,
    sessionTTL: 2 * 60 * 60 * 1000, // 2 小时
    browserDebugPort: parseInt(process.env.SCHOOL_BROWSER_DEBUG_PORT) || 9222,
  },
  // 自有账号系统配置
  auth: {
    inviteCode: process.env.AUTH_INVITE_CODE || '',
  },
  // 管理员登录配置（密码未设置时生成随机密码，禁止空密码）
  admin: (() => {
    let password = process.env.ADMIN_PASSWORD || '';
    if (!password) {
      password = require('crypto').randomBytes(12).toString('base64url');
      console.warn('[Config] 未设置 ADMIN_PASSWORD，已生成随机管理员密码:', password);
      console.warn('[Config] 请在 .env 中设置 ADMIN_PASSWORD 以固定管理员密码');
    }
    return {
      username: process.env.ADMIN_USERNAME || 'admin',
      password,
    };
  })(),
};




