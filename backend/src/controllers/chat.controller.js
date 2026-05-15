const { ChatService } = require('../services/chat.service');
const { XunfeiService } = require('../services/xunfei.service');
const { SummaryService } = require('../services/summary.service');
const { successResponse } = require('../utils/response');

let chatService = null;
let xunfeiService = null;
let summaryService = null;

const getChatService = () => {
  if (!chatService) chatService = new ChatService();
  return chatService;
};

const getXunfeiService = () => {
  if (!xunfeiService) xunfeiService = new XunfeiService();
  return xunfeiService;
};

const getSummaryService = () => {
  if (!summaryService) summaryService = new SummaryService();
  return summaryService;
};

const chat = async (req, res, next) => {
  try {
    const { message, history } = req.body;
    if (!message) {
      throw new Error('Message is required');
    }
    const result = await getChatService().getResponse(message, history || []);
    successResponse(res, result, 'Message processed');
  } catch (error) {
    next(error);
  }
};

/**
 * SSE 流式聊天接口
 */
const chatStream = async (req, res, next) => {
  try {
    const { message, history } = req.body;
    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    // 处理历史消息：摘要压缩
    let processedHistory = history || [];
    if (getSummaryService().shouldSummarize(processedHistory.length, 15)) {
      const { toSummarize, toKeep } = getSummaryService().splitMessages(processedHistory, 10);
      if (toSummarize.length > 0) {
        const summary = await getSummaryService().summarize(toSummarize);
        // 将摘要作为系统消息插入
        processedHistory = [
          { role: 'system', content: `[历史对话摘要]\n${summary}` },
          ...toKeep
        ];
        console.log(`[摘要压缩] 原始消息: ${history.length}条 -> 压缩后: ${processedHistory.length}条`);
      }
    }

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 流式输出
    for await (const chunk of getXunfeiService().getCompletionStream(message, processedHistory)) {
      if (chunk.done) {
        res.write(`data: [DONE]\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
      }
    }
    res.end();
  } catch (error) {
    console.error('Stream error:', error);
    res.write(`data: ${JSON.stringify({ error: '流式响应出错，请重试' })}\n\n`);
    res.end();
  }
};

/**
 * 从消息中提取用户问题
 */
function extractQuestion(message) {
  if (!message) return '';
  // 匹配 "用户问题：xxx" 后面跟 "AI回答" 或换行
  const match = message.match(/用户问题[：:]\s*(.+?)(?:\s*AI回答|$)/s);
  if (match && match[1].trim()) {
    return match[1].trim();
  }
  // 没匹配到就返回原始消息前8个字
  return message.slice(0, 8);
}

/**
 * 生成会话标题
 */
const generateTitle = async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    const { AnthropicService } = require('../services/anthropic.service');
    const anthropic = new AnthropicService();

    const prompt = `你是一个标题生成器。请根据以下对话内容，生成一个简短标题。
规则：
1. 不超过8个汉字
2. 只输出标题，不要任何解释
3. 概括对话主题，不要直接复制原文
4. 不要加引号、冒号等符号

对话内容：
${message}

标题：`;

    const result = await anthropic.getCompletion(prompt, []);
    let title = (result.content || '').replace(/["'「」【】：:]/g, '').trim();

    // 截断过长标题
    if (title.length > 10) {
      title = title.slice(0, 10);
    }

    // 降级：直接从用户问题提取
    if (!title || title.length < 2) {
      title = extractQuestion(message).slice(0, 8);
    }

    res.json({ title });
  } catch (error) {
    console.error('Generate title error:', error);
    const { message = '' } = req.body || {};
    res.json({ title: extractQuestion(message).slice(0, 8) });
  }
};

module.exports = { chat, chatStream, generateTitle };
