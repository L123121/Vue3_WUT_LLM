const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const { ChatService } = require('./services/chat.service');
const { XunfeiService } = require('./services/xunfei.service');
const config = require('./config');
const { conversationStore } = require('./services/redis.service');
const { chromaService } = require('./services/chroma.service');
const { RagService } = require('./services/rag.service');
const ragRoutes = require('./routes/rag.routes');
const authRoutes = require('./routes/auth.routes');
const conversationsRoutes = require('./routes/conversations.routes');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

const chatService = new ChatService();
const xunfeiService = new XunfeiService();
const ragService = new RagService();

// 用量统计
const usageEvents = [];
const MAX_USAGE_EVENTS = 1000;

const estimateTokens = (text) => Math.max(1, Math.ceil(String(text || '').length / 4));
const collectHistoryText = (history) => Array.isArray(history)
  ? history.map((item) => String(item?.content || '')).join('\n')
  : '';

const recordUsageEvent = ({ inputText, outputText }) => {
  const inputTokens = estimateTokens(inputText || '');
  const outputTokens = estimateTokens(outputText || '');
  const event = {
    timestamp: Date.now(),
    requestCount: 1,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedTokens: 0,
    estimatedCost: (inputTokens / 1000) * 0.002 + (outputTokens / 1000) * 0.006,
  };
  usageEvents.push(event);
  if (usageEvents.length > MAX_USAGE_EVENTS) {
    usageEvents.splice(0, usageEvents.length - MAX_USAGE_EVENTS);
  }
};

const getUsageSnapshot = (hours = 24) => {
  const safeHours = Number.isFinite(hours) && hours > 0 ? Math.min(hours, 24 * 30) : 24;
  const now = Date.now();
  const from = now - safeHours * 60 * 60 * 1000;
  const recent = usageEvents.filter((event) => event.timestamp >= from && event.timestamp <= now);
  const summary = recent.reduce((acc, item) => ({
    requestCount: acc.requestCount + item.requestCount,
    inputTokens: acc.inputTokens + item.inputTokens,
    outputTokens: acc.outputTokens + item.outputTokens,
    totalTokens: acc.totalTokens + item.totalTokens,
    cachedTokens: acc.cachedTokens + item.cachedTokens,
    estimatedCost: acc.estimatedCost + item.estimatedCost,
  }), {
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    estimatedCost: 0,
  });
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  const useHourly = safeHours <= 24;
  const bucketMs = useHourly ? hourMs : dayMs;
  const pointCount = useHourly ? safeHours : Math.ceil(safeHours / 24);
  const granularity = useHourly ? 'hour' : 'day';
  const trend = Array.from({ length: pointCount }, (_, index) => {
    const start = from + index * bucketMs;
    const end = start + bucketMs;
    const date = new Date(start);
    const label = useHourly
      ? `${String(date.getHours()).padStart(2, '0')}:00`
      : `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
    return {
      label,
      start,
      end,
      tokens: 0,
      requests: 0,
      estimatedCost: 0,
    };
  });
  recent.forEach((event) => {
    const point = trend.find((item) => event.timestamp >= item.start && event.timestamp < item.end);
    if (!point) return;
    point.tokens += event.totalTokens;
    point.requests += event.requestCount;
    point.estimatedCost += event.estimatedCost;
  });
  return {
    summary,
    trend,
    rangeHours: safeHours,
    granularity,
  };
};

// 中间件
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true
}));
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 健康检查
app.get('/api/health', (req, res) => {
  const hasApiConfig = !!config.xunfei.apiKey;
  res.json({
    status: 'ok',
    message: '武理小精灵后端服务运行正常',
    timestamp: new Date().toISOString(),
    ai_service: {
      enabled: hasApiConfig,
      provider: 'iFlyTek Spark',
      model: config.xunfei.model || '未配置',
      status: hasApiConfig ? '配置正常' : '模拟模式'
    },
    redis: 'connected'
  });
});

// API 列表
app.get('/api', (req, res) => {
  res.json({
    app: '武理小精灵后端',
    version: '1.0.0',
    endpoints: [
      { method: 'GET', path: '/api/health', description: '健康检查' },
      { method: 'GET', path: '/api', description: 'API列表' },
      { method: 'GET', path: '/api/usage', description: '近24小时用量统计' },
      { method: 'POST', path: '/api', description: '聊天接口' },
      { method: 'POST', path: '/api/stream', description: '流式聊天接口' },
      { method: 'GET', path: '/api/conversations', description: '获取会话列表' },
      { method: 'POST', path: '/api/conversations', description: '创建会话' },
    ]
  });
});

app.get('/api/usage', (req, res) => {
  const hours = Number.parseInt(String(req.query.hours || '24'), 10);
  const data = getUsageSnapshot(hours);
  res.json({
    success: true,
    data,
    meta: {
      source: 'server-runtime',
      updatedAt: new Date().toISOString(),
    },
  });
});

// 聊天请求处理函数
const handleChatRequest = async (req, res, endpoint = '/api') => {
  try {
    const { message, history = [], conversationId } = req.body;
    console.log(`🤖 ${endpoint} 收到请求:`, message?.substring(0, 50));

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({
        success: false,
        error: '消息内容不能为空',
        code: 'MESSAGE_EMPTY'
      });
    }

    // 调用AI服务
    const result = await chatService.getResponse(message.trim(), history);
    recordUsageEvent({
      inputText: `${message.trim()}\n${collectHistoryText(history)}`,
      outputText: result.reply,
    });

    console.log(`✅ ${endpoint} AI回复:`, result.reply.substring(0, 50));
    res.json({
      success: true,
      data: {
        reply: result.reply,
        timestamp: result.timestamp,
        messageId: `msg_${Date.now()}`,
        model: result.model,
        isMock: result.isMock,
        via: endpoint
      }
    });
  }
  catch (error) {
    console.error(`❌ ${endpoint} 处理错误:`, error);
    res.status(500).json({
      success: false,
      error: 'AI服务处理失败',
      code: 'SERVER_ERROR'
    });
  }
};

// 主聊天接口
app.post('/api', (req, res) => {
  handleChatRequest(req, res, '/api');
});

// 兼容接口
app.post('/api/chat', (req, res) => {
  handleChatRequest(req, res, '/api/chat');
});

// RAG 知识库路由
app.use('/api/rag', ragRoutes);

// 认证路由
app.use('/api/auth', authRoutes);

// 会话路由
app.use('/api/conversations', conversationsRoutes);

// SSE 流式聊天接口
app.post('/api/stream', async (req, res) => {
  try {
    const { message, history = [], conversationId, enableRag = false } = req.body;
    let streamReply = '';
    console.log('🌊 /api/stream 收到流式请求:', message?.substring(0, 50), enableRag ? '(RAG启用)' : '');

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({
        success: false,
        error: '消息内容不能为空'
      });
    }

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // RAG 增强
    let enhancedMessage = message.trim();
    let sources = [];

    if (enableRag && chromaService.isConnected) {
      try {
        const relevantDocs = await ragService.retrieve(message.trim());
        sources = relevantDocs.map(d => ({
          id: d.id,
          title: d.metadata?.title
        }));

        const context = ragService.buildContext(relevantDocs);
        enhancedMessage = ragService.buildRagPrompt(message.trim(), context);

        // 发送来源信息
        if (sources.length > 0) {
          res.write(`data: ${JSON.stringify({ sources })}\n\n`);
        }
      } catch (ragError) {
        console.warn('[RAG] 检索失败，使用普通模式:', ragError.message);
      }
    }

    // 流式输出
    for await (const chunk of xunfeiService.getCompletionStream(enhancedMessage, history)) {
      if (chunk.done) {
        res.write(`data: [DONE]\n\n`);
      }
      else {
        streamReply += chunk.content || '';
        res.write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
      }
    }

    // 如果有 conversationId，保存消息到 Redis
    if (conversationId) {
      const userMsg = {
        id: `msg_${Date.now()}_user`,
        role: 'user',
        text: message.trim(),
        timestamp: new Date().toISOString()
      };
      const aiMsg = {
        id: `msg_${Date.now()}_ai`,
        role: 'model',
        text: streamReply,
        timestamp: new Date().toISOString()
      };
      await conversationStore.addMessage(conversationId, userMsg);
      await conversationStore.addMessage(conversationId, aiMsg);
    }

    recordUsageEvent({
      inputText: `${message.trim()}\n${collectHistoryText(history)}`,
      outputText: streamReply,
    });
    console.log('✅ /api/stream 流式响应完成');
    res.end();
  }
  catch (error) {
    console.error('❌ /api/stream 错误:', error);
    console.error('错误堆栈:', error.stack);
    res.write(`data: ${JSON.stringify({ error: 'Stream error: ' + error.message })}\n\n`);
    res.end();
  }
});

// 404 处理
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: '接口不存在',
    path: req.originalUrl
  });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({
    success: false,
    error: '服务器内部错误'
  });
});

// 启动服务器
app.listen(PORT, '0.0.0.0', async () => {
  const hasApi = !!config.xunfei.apiKey;
  console.log('='.repeat(60));
  console.log('🚀 武理小精灵后端服务启动成功！');
  console.log(`📍 地址：http://localhost:${PORT}`);
  console.log(`🤖 AI服务：${hasApi ? '讯飞星火模型' : '模拟模式'}`);
  console.log(`📡 模型：${config.xunfei.model || '未配置'}`);
  console.log(`💾 存储：Redis`);

  // 初始化 Chroma 向量数据库
  const chromaHost = config.chroma?.host || 'http://localhost:8000';
  const chromaConnected = await chromaService.connect(chromaHost);
  if (chromaConnected) {
    console.log(`📚 RAG知识库：Chroma 已连接`);
  } else {
    console.log(`📚 RAG知识库：Chroma 未连接（RAG功能不可用）`);
  }

  console.log('='.repeat(60));
});
