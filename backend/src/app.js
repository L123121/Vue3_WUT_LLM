const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { ChatService } = require('./services/chat.service');
const { XunfeiService } = require('./services/xunfei.service');
const { AnthropicService } = require('./services/anthropic.service');
const config = require('./config');
const { conversationStore, redis } = require('./services/redis.service');
const { RagService } = require('./services/rag.service');
const ragRoutes = require('./routes/rag.routes');
const authRoutes = require('./routes/auth.routes');
const conversationsRoutes = require('./routes/conversations.routes');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

const anthropicService = new AnthropicService();
const xunfeiService = new XunfeiService();
const chatService = new ChatService(anthropicService);
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
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// 速率限制
const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { success: false, error: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 健康检查
app.get('/api/health', (req, res) => {
  const hasApiConfig = !!config.anthropic.authToken;
  const redisStatus = redis && redis.status === 'ready' ? 'connected' : 'disconnected';
  res.json({
    status: 'ok',
    message: '武理小精灵后端服务运行正常',
    timestamp: new Date().toISOString(),
    ai_service: {
      enabled: hasApiConfig,
      provider: 'Anthropic',
      model: config.anthropic.model || '未配置',
      status: hasApiConfig ? '配置正常' : '模拟模式'
    },
    redis: redisStatus
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
const MAX_MESSAGE_LENGTH = 10000;
const MAX_HISTORY_LENGTH = 50;

const handleChatRequest = async (req, res, endpoint = '/api') => {
  try {
    const { message, history = [], conversationId } = req.body;

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({
        success: false,
        error: '消息内容不能为空',
        code: 'MESSAGE_EMPTY'
      });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `消息内容过长，最多${MAX_MESSAGE_LENGTH}个字符`,
        code: 'MESSAGE_TOO_LONG'
      });
    }

    if (!Array.isArray(history) || history.length > MAX_HISTORY_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `历史消息过多，最多${MAX_HISTORY_LENGTH}条`,
        code: 'HISTORY_TOO_LONG'
      });
    }

    // 调用AI服务
    const result = await chatService.getResponse(message.trim(), history);
    recordUsageEvent({
      inputText: `${message.trim()}\n${collectHistoryText(history)}`,
      outputText: result.reply,
    });

    console.log(`✅ ${endpoint} AI回复完成`);
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
app.post('/api', chatLimiter, (req, res) => {
  handleChatRequest(req, res, '/api');
});

// 生成会话标题
const { generateTitle } = require('./controllers/chat.controller');
app.post('/api/chat/title', chatLimiter, generateTitle);

// 兼容接口
app.post('/api/chat', chatLimiter, (req, res) => {
  handleChatRequest(req, res, '/api/chat');
});

// RAG 知识库路由
app.use('/api/rag', ragRoutes);

// 认证路由
app.use('/api/auth', authRoutes);

// 会话路由
app.use('/api/conversations', conversationsRoutes);

// SSE 流式聊天接口
app.post('/api/stream', chatLimiter, async (req, res) => {
  try {
    const { message, history = [], conversationId, enableRag = false } = req.body;
    let streamReply = '';

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({
        success: false,
        error: '消息内容不能为空'
      });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `消息内容过长，最多${MAX_MESSAGE_LENGTH}个字符`
      });
    }

    if (!Array.isArray(history) || history.length > MAX_HISTORY_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `历史消息过多，最多${MAX_HISTORY_LENGTH}条`
      });
    }

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    if (enableRag) {
      // RAG 模式：通过 ragService 统一处理（星火知识库优先）
      for await (const chunk of ragService.chatStream(message.trim(), history)) {
        if (chunk.type === 'sources') {
          res.write(`data: ${JSON.stringify({ sources: chunk.sources })}\n\n`);
        } else if (chunk.type === 'content') {
          if (chunk.done) {
            res.write(`data: [DONE]\n\n`);
          } else {
            streamReply += chunk.content || '';
            res.write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
          }
        }
      }
    } else {
      // 普通模式
      for await (const chunk of anthropicService.getCompletionStream(message.trim(), history)) {
        if (chunk.done) {
          res.write(`data: [DONE]\n\n`);
        } else {
          streamReply += chunk.content || '';
          res.write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
        }
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
    res.write(`data: ${JSON.stringify({ error: '流式响应出错，请重试' })}\n\n`);
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
  const hasApi = !!config.anthropic.authToken;
  console.log('='.repeat(60));
  console.log('🚀 武理小精灵后端服务启动成功！');
  console.log(`📍 地址：http://localhost:${PORT}`);
  console.log(`🤖 AI服务：${hasApi ? 'Anthropic' : '模拟模式'}`);
  console.log(`📡 模型：${config.anthropic.model || '未配置'}`);
  console.log(`💾 存储：Redis`);
  console.log(`📚 RAG知识库：星火知识库 (chatdoc.xfyun.cn)`);
  console.log('='.repeat(60));
});
