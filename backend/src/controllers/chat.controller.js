"use strict";

const { AgentService } = require('../services/agent.service');
const { aiService } = require('../services/ai.service');
const { metrics } = require('../services/metrics.service');

// 单例服务
let _agentService = null;
const getAgentService = () => {
  if (!_agentService) {
    _agentService = new AgentService(aiService);
    _agentService.memoryService = require('../routes/index').memoryService;
  }
  return _agentService;
};

const MAX_MESSAGE_LENGTH = 50000;
const MAX_HISTORY_LENGTH = 50;

// ==================== 非流式聊天 ====================

/**
 * POST /api — 非流式聊天（默认 Agent 意图路由）
 * POST /api/chat — 兼容接口
 */
const chatHandler = async (req, res) => {
  try {
    const { message, history = [], conversationId } = req.body;

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({
        success: false,
        error: '消息内容不能为空',
        code: 'MESSAGE_EMPTY',
      });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `消息内容过长，最多${MAX_MESSAGE_LENGTH}个字符`,
        code: 'MESSAGE_TOO_LONG',
      });
    }

    if (!Array.isArray(history) || history.length > MAX_HISTORY_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `历史消息过多，最多${MAX_HISTORY_LENGTH}条`,
        code: 'HISTORY_TOO_LONG',
      });
    }

    // 默认走 Agent 意图路由
    const userId = req.userId || null;
    console.log(`[Chat] Agent 非流式, userId: ${userId || 'anonymous'}`);

    const chunks = [];
    for await (const chunk of getAgentService().chatStream(message.trim(), history, { userId })) {
      if (chunk.type === 'content' && chunk.content) {
        chunks.push(chunk.content);
      }
    }

    const reply = chunks.join('');
    res.json({
      success: true,
      data: {
        reply,
        timestamp: new Date().toISOString(),
        messageId: `msg_${Date.now()}`,
        model: getAgentService().aiService.model,
        via: 'agent',
      },
    });
  } catch (error) {
    console.error('[Chat] request failed:', error);
    res.status(500).json({
      success: false,
      error: 'AI服务处理失败',
      code: 'SERVER_ERROR',
    });
  }
};

// ==================== SSE 流式聊天 ====================

/**
 * POST /api/stream — SSE 流式聊天（默认 Agent 意图路由）
 */
const streamHandler = async (req, res) => {
  let streamAborted = false;
  req.on('close', () => { streamAborted = true; });

  try {
    const { message, history = [], conversationId, files = [], skillPrompt = '' } = req.body;

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ success: false, error: '消息内容不能为空' });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `消息内容过长，最多${MAX_MESSAGE_LENGTH}个字符`,
      });
    }

    if (!Array.isArray(history) || history.length > MAX_HISTORY_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `历史消息过多，最多${MAX_HISTORY_LENGTH}条`,
      });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 默认走 Agent 意图路由
    const userId = req.userId || null;
    console.log(`[Stream] Agent 模式(默认), userId: ${userId || 'anonymous'}`);

    for await (const chunk of getAgentService().chatStream(message.trim(), history, { userId, skillPrompt })) {
      if (streamAborted) break;

      switch (chunk.type) {
        case 'thinking':
          res.write(`data: ${JSON.stringify({ thinking: chunk.content })}\n\n`);
          break;
        case 'tool_call':
          res.write(`data: ${JSON.stringify({ tool_call: chunk.tool_call })}\n\n`);
          break;
        case 'tool_result':
          res.write(`data: ${JSON.stringify({ tool_result: chunk.tool_result })}\n\n`);
          break;
        case 'content':
          if (chunk.done) {
            res.write(`data: [DONE]\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
          }
          break;
      }
    }

    if (!streamAborted) {
      console.log('[Chat] /api/stream completed.');
      res.end();
    }
  } catch (error) {
    if (!streamAborted) {
      console.error('[Chat] /api/stream failed:', error);
      res.write(`data: ${JSON.stringify({ error: '流式响应出错，请重试' })}\n\n`);
      res.end();
    }
  }
};

/**
 * 生成会话标题
 */
const generateTitle = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    // 检测纯问候场景，直接返回默认标题
    const firstLine = message.split('\n')[0].trim();
    const greetingPattern = /^(你好|您好|hi|hello|嗨|hey|在吗|在不在|早上好|晚上好|下午好)[!！.。]?\s*$/i;
    if (greetingPattern.test(firstLine)) {
      return res.json({ title: '新对话' });
    }

    // 旧的问候检测（兼容旧格式）
    const oldGreetingPattern = /^(用户问题[：:]\s*)(你好|您好|hi|hello|嗨|hey|在吗|在不在|早上好|晚上好|下午好)[!！.。]?\s*(AI回答|$)/i;
    if (greetingPattern.test(message)) {
      return res.json({ title: '新对话' });
    }

    const prompt = `你是一个对话标题生成器。根据用户的问题和AI的回答，生成一个**简短、准确**的标题。

要求：
- 4-10个汉字，概括对话的核心主题
- 用日常语言，不要机器翻译腔
- 不要加引号、冒号、书名号等符号
- 只输出标题本身，不要任何解释或前缀
- 重要：用户只说"你好""谢谢"这类问候语时，直接输出"新对话"

示例：
高等数学期末考试怎么复习？
建议先梳理教材各章知识点...
→ 高数复习攻略

Python列表和元组有什么区别？
列表可变而元组不可变...
→ Python列表元组区别

帮我写一篇关于人工智能的论文摘要
本文探讨了人工智能在医疗领域的应用...
→ AI医疗应用论文

对话内容：
${message}

标题：`;

    const { aiService } = require('../services/ai.service');
    const result = await aiService.getCompletion(prompt, []);
    let title = (result.content || '')
      .replace(/[""'']/g, '')
      .replace(/[「」【】《》〈〉：:]/g, '')
      .trim();

    // 截断过长标题
    if (title.length > 15) {
      title = title.slice(0, 15);
    }

    // 过滤不合格标题（太短、纯问候、无意义）
    const badTitles = ['你好', '您好', 'hello', 'hi', 'hey', '新对话', '标题', '无标题'];
    if (!title || title.length < 2 || badTitles.includes(title) || /^(你好|您好|谢谢|感谢|hello|hi)\s*/.test(title)) {
      const extracted = extractQuestion(message).slice(0, 8);
      title = extracted || '新对话';
    }

    // 标题不能太短
    if (title.length < 2) title = '新对话';

    res.json({ title });
  } catch (error) {
    console.error('Generate title error:', error);
    const { message = '' } = req.body || {};
    const fallback = extractQuestion(message).slice(0, 8);
    res.json({ title: fallback || '新会话' });
  }
};

function extractQuestion(message) {
  if (!message) return '';
  const match = message.match(/用户问题[：:]\s*(.+?)(?:\s*AI回答|$)/s);
  if (match && match[1].trim()) {
    return match[1].trim();
  }
  return message.slice(0, 8);
}

module.exports = { chatHandler, streamHandler };
