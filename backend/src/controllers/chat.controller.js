const { ChatService } = require('../services/chat.service');
const { XunfeiService } = require('../services/xunfei.service');
const { SummaryService } = require('../services/summary.service');
const { successResponse } = require('../utils/response');

const chatService = new ChatService();
const xunfeiService = new XunfeiService();
const summaryService = new SummaryService();

const chat = async (req, res, next) => {
  try {
    const { message, history } = req.body;
    if (!message) {
      throw new Error('Message is required');
    }
    const result = await chatService.getResponse(message, history || []);
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
    if (summaryService.shouldSummarize(processedHistory.length, 15)) {
      const { toSummarize, toKeep } = summaryService.splitMessages(processedHistory, 10);
      if (toSummarize.length > 0) {
        const summary = await summaryService.summarize(toSummarize);
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
    for await (const chunk of xunfeiService.getCompletionStream(message, processedHistory)) {
      if (chunk.done) {
        res.write(`data: [DONE]\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
      }
    }
    res.end();
  } catch (error) {
    console.error('Stream error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
    res.end();
  }
};

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

    // 使用简短提示生成标题
    const prompt = `请根据以下用户消息，生成一个简短的会话标题（不超过15个字，不要加引号或其他符号）：
用户消息：${message}

标题：`;

    const result = await xunfeiService.getCompletion(prompt, []);
    let title = result.content || '';

    // 清理标题：去除引号、换行等
    title = title.replace(/["'「」【】]/g, '').trim();
    if (title.length > 20) {
      title = title.slice(0, 20);
    }

    // 如果生成失败或标题为空，使用消息前15个字符
    if (!title || title.length < 2) {
      title = message.slice(0, 15);
    }

    res.json({ title });
  } catch (error) {
    console.error('Generate title error:', error);
    // 降级：返回消息前15个字符
    res.json({ title: (req.body.message || '').slice(0, 15) });
  }
};

module.exports = { chat, chatStream, generateTitle };
