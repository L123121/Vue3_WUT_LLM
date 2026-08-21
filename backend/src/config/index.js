// config.js
require('dotenv').config();
const path = require('path');
const aiBaseUrl = process.env.AI_BASE_URL || 'https://api.stepfun.com/v1';

if (!process.env.VITEST) {
  const requiredEnv = ['AI_API_KEY', 'JWT_SECRET'];
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
    baseUrl: aiBaseUrl,
    model: process.env.AI_MODEL || 'step-3.7-flash',
    maxTokens: 4000,
    temperature: 0.7,
    timeout: 60000,
    // 推理模型思考链开关（默认关闭，避免思考 token 耗尽输出预算导致空回复）
    enableThinking: process.env.AI_ENABLE_THINKING === 'true',
    // 备用 provider（可选，主 provider 失败时自动切换）
    fallback: {
      apiKey: process.env.AI_FALLBACK_API_KEY || '',
      baseUrl: process.env.AI_FALLBACK_BASE_URL || '',
      model: process.env.AI_FALLBACK_MODEL || '',
      maxTokens: parseInt(process.env.AI_FALLBACK_MAX_TOKENS, 10) || 4000,
      temperature: parseFloat(process.env.AI_FALLBACK_TEMPERATURE) || 0.7,
      timeout: parseInt(process.env.AI_FALLBACK_TIMEOUT, 10) || 60000,
    },
  },
  audio: {
    apiKey: process.env.STEPFUN_API_KEY || (aiBaseUrl.includes('api.stepfun.com') ? process.env.AI_API_KEY : ''),
    baseUrl: process.env.STEPFUN_AUDIO_BASE_URL || (aiBaseUrl.includes('/step_plan/v1') ? aiBaseUrl : 'https://api.stepfun.com/v1'),
    model: process.env.STEPFUN_TTS_MODEL || 'stepaudio-2.5-tts',
    voice: process.env.STEPFUN_TTS_VOICE || 'cixingnansheng',
    responseFormat: process.env.STEPFUN_TTS_FORMAT || 'mp3',
    speed: Number.parseFloat(process.env.STEPFUN_TTS_SPEED || '1'),
    instruction: process.env.STEPFUN_TTS_INSTRUCTION || '自然、亲切、清晰，像校园里的学长学姐耐心回答问题',
    timeout: parseInt(process.env.STEPFUN_TTS_TIMEOUT, 10) || 60000,
    maxInputLength: 1000,
    maxAudioBytes: parseInt(process.env.STEPFUN_TTS_MAX_AUDIO_BYTES, 10) || 16 * 1024 * 1024,
    cacheEnabled: process.env.STEPFUN_TTS_CACHE_ENABLED !== 'false',
    cacheTtlMs: parseInt(process.env.STEPFUN_TTS_CACHE_TTL_MS, 10) || 30 * 60 * 1000,
    cacheMaxEntries: parseInt(process.env.STEPFUN_TTS_CACHE_MAX_ENTRIES, 10) || 100,
    cacheMaxBytes: parseInt(process.env.STEPFUN_TTS_CACHE_MAX_BYTES, 10) || 64 * 1024 * 1024,
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
  // OCR / 视觉识别配置（扫描件 PDF 与图片表格识别，走 StepFun step-1o-turbo-vision）
  ocr: {
    enabled: process.env.OCR_ENABLED !== 'false',
    model: process.env.OCR_MODEL || 'step-1o-turbo-vision',
    // detail=low ~169 token/图（默认）；表格等细节场景可切 high（按图大小计费）
    detail: process.env.OCR_DETAIL || 'low',
    maxPages: parseInt(process.env.OCR_MAX_PAGES, 10) || 30,
    // 页级识别并发上限（成本与限流闸门）
    concurrency: parseInt(process.env.OCR_CONCURRENCY, 10) || 2,
    // pdf-parse 提取文本低于该阈值视为扫描件，触发 OCR 兜底
    pdfMinChars: parseInt(process.env.OCR_PDF_MIN_CHARS, 10) || 30,
    // 文本型 PDF 表格页检测 + 按页 OCR 重建 Markdown 表格（复用视觉模型，零新依赖）
    tableOcrEnabled: process.env.OCR_TABLE_ENABLED !== 'false',
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
  // 向量数据库（Qdrant 独立服务 / Milvus 兼容字段保留，实际由 vector-store 按 backend 分发）
  vectorStore: {
    backend: process.env.VECTOR_STORE_BACKEND || 'qdrant',
    // Qdrant（VECTOR_STORE_BACKEND=qdrant 时启用）
    qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
    qdrantApiKey: process.env.QDRANT_API_KEY || '',
    collectionName: process.env.QDRANT_COLLECTION || process.env.MILVUS_COLLECTION || 'wuli_elf_chunks',
    // Milvus 兼容字段（遗留，未启用时忽略）
    milvusAddress: process.env.MILVUS_ADDRESS || process.env.MILVUS_URI || 'localhost:19530',
    milvusToken: process.env.MILVUS_TOKEN || '',
    denseField: process.env.MILVUS_DENSE_FIELD || 'dense_vector',
    sparseField: process.env.MILVUS_SPARSE_FIELD || 'sparse_vector',
    vectorWeight: Number.parseFloat(process.env.MILVUS_DENSE_WEIGHT || process.env.RAG_VECTOR_WEIGHT || '0.6'),
    sparseWeight: Number.parseFloat(process.env.MILVUS_SPARSE_WEIGHT || process.env.RAG_SPARSE_WEIGHT || '0.4'),
    // RRF 融合常数（文件后端默认融合方式，RAG_RRF_K 全局共享）
    rrfK: parseInt(process.env.RAG_RRF_K, 10) || 60,
    // 混合检索融合方式：weighted（默认，0.6/0.4 加权打分，官方评测优于 RRF）
    // | rrf（倒数排名融合，RAG_FUSION=rrf 可切换，2026-08-09 实测 Recall 74.5% vs 加权 80.7%）
    fusion: process.env.RAG_FUSION || 'weighted',
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
    // 父段归并后 MMR 去重：剔除与已选父段高度相似的冗余段落
    mmrEnabled: process.env.RAG_MMR_ENABLED !== 'false',
    mmrLambda: Number.parseFloat(process.env.RAG_MMR_LAMBDA || '0.7'),
    mmrMaxSim: Number.parseFloat(process.env.RAG_MMR_MAX_SIM || '0.85'),
    // 元数据过滤（Multi-faceted Filtering）：按问题关键词自动推断文档类别过滤候选
    autoCategoryFilter: process.env.RAG_AUTO_CATEGORY_FILTER !== 'false',
    // 意图识别自动路由（V2.0）：前端不再手动开关 RAG，后端自动路由
    // rag=知识库检索 / chat=纯对话 / agent=工具调度（INTENT_ROUTING_ENABLED=false 可整体关闭，退回原链路）
    intentRoutingEnabled: process.env.INTENT_ROUTING_ENABLED !== 'false',
    // LLM 意图分类兜底（默认关：避免每条消息多一次 LLM 调用拖慢首包延迟；fastRoute 零成本路由常开）
    intentClassifyEnabled: process.env.INTENT_CLASSIFY_ENABLED === 'true',
    // 检索多级缓存（2026-08-20 新增）
    cacheEnabled: process.env.RAG_CACHE_ENABLED !== 'false',
    cacheTtlMs: parseInt(process.env.RAG_CACHE_TTL_MS, 10) || 300000,           // 5min
    cacheMaxEntries: parseInt(process.env.RAG_CACHE_MAX_ENTRIES, 10) || 500,
    rerankerCacheMaxEntries: parseInt(process.env.RAG_RERANKER_CACHE_MAX, 10) || 2000,
    rewriteCacheMaxEntries: parseInt(process.env.RAG_REWRITE_CACHE_MAX, 10) || 500,
    compactCacheMaxEntries: parseInt(process.env.RAG_COMPACT_CACHE_MAX, 10) || 200,
    compactCacheTtlMs: parseInt(process.env.RAG_COMPACT_CACHE_TTL_MS, 10) || 1800000, // 30min
  },
  // 轻量 Agent 工具调度（V2.0）：默认启用；AGENT_TOOL_ENABLED=false 可一键回退 RAG
  agent: {
    toolEnabled: process.env.AGENT_TOOL_ENABLED !== 'false',
    // 工具决策/执行超时（毫秒）
    decideTimeoutMs: parseInt(process.env.AGENT_DECIDE_TIMEOUT_MS, 10) || 15000,
    toolTimeoutMs: parseInt(process.env.AGENT_TOOL_TIMEOUT_MS, 10) || 15000,
    // 多轮工具调度上限（L2）：最多轮次，防止无限循环；配合无进展检测强制收尾
    maxToolRounds: parseInt(process.env.AGENT_MAX_TOOL_ROUNDS, 10) || 2,
  },
  // 受控 Agentic RAG：默认关闭，灰度开启后仅替换知识库问答链路
  agenticRag: {
    enabled: process.env.AGENTIC_RAG_ENABLED === 'true',
    // 最多 3 轮，避免检索循环失控
    maxRounds: Math.min(Math.max(parseInt(process.env.AGENTIC_RAG_MAX_ROUNDS, 10) || 2, 1), 3),
    maxDurationMs: parseInt(process.env.AGENTIC_RAG_MAX_DURATION_MS, 10) || 20000,
    rewriteTimeoutMs: parseInt(process.env.AGENTIC_RAG_REWRITE_TIMEOUT_MS, 10) || 8000,
    minSources: Math.max(parseInt(process.env.AGENTIC_RAG_MIN_SOURCES, 10) || 1, 1),
  },
  // 自有账号系统配置
  auth: {
    inviteCode: process.env.AUTH_INVITE_CODE || '',
  },
  // 用户级配额限制（每日 LLM 调用次数）
  quota: {
    dailyLimit: parseInt(process.env.QUOTA_DAILY_LIMIT, 10) || 100,
    anonymousLimit: parseInt(process.env.QUOTA_ANONYMOUS_LIMIT, 10) || 20,
    adminLimit: parseInt(process.env.QUOTA_ADMIN_LIMIT, 10) || 1000,
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
