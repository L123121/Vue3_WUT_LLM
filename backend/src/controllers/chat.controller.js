/**
 * chat.controller — 精简对话控制器（替代原 agent 驱动的 chat.controller）
 *
 * 移除了 ReAct Agent 多步推理循环，直接使用 RAG 检索 + LLM 生成。
 * 校园场景 80%+ 是事实查询，不需要 Agent 的多步规划。
 * 历史：2026-07-21 移除 Agent 系统，回归 RAG 对话模式。
 */

"use strict";

const { RagService } = require('../services/rag.service');
const { ChatService } = require('../services/chat.service');
const { aiService } = require('../services/ai.service');

const ragService = new RagService(aiService);
const chatService = new ChatService(aiService);

/**
 * 非流式聊天接口
 */
const chatHandler = async (req, res, next) => {
  try {
    const { message, history } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, error: '消息内容不能为空' });
    }

    const result = await ragService.chat(message, history || [], {
      traceId: req.traceId,
      userId: req.userId,
      conversationId: req.body?.conversationId || null,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[Chat] 非流式错误:', error);
    next(error);
  }
};

/**
 * 流式聊天接口（SSE）— 直接使用 RAG 检索管道
 */
const streamHandler = async (req, res, next) => {
  try {
    const { message, history } = req.body;

    if (!message) {
      return res.status(400).json({ error: '消息内容不能为空' });
    }

    // 检测是否为简单问候/闲聊（不触发 RAG 检索）
    const trimmed = message.trim();
    const isSimpleChat = /^(你好|您好|hi|hello|嗨|hey|在吗|thanks|谢谢|bye|再见|早上好|晚上好|下午好)[!！.。]?$/i.test(trimmed);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    if (isSimpleChat) {
      // 简单问候直接走 LLM，不检索知识库
      const systemPrompt = '你是一个友好的校园助手，名字叫"武理小精灵"，回答要简洁亲切。';
      const chatHistory = [
        { role: 'system', content: systemPrompt },
        ...(history || []),
      ];
      const stream = aiService.getCompletionStream(message, chatHistory);
      for await (const chunk of stream) {
        if (chunk.done) {
          res.write('data: [DONE]\n\n');
        } else {
          res.write(`data: ${JSON.stringify({ content: chunk.content || '' })}\n\n`);
        }
      }
      res.end();
      return;
    }

    // 知识问答走 RAG 检索管道
    for await (const chunk of ragService.chatStream(message, history || [], {
      traceId: req.traceId,
      userId: req.userId,
      conversationId: req.body?.conversationId || null,
    })) {
      if (chunk.type === 'retrieval') {
        // 检索细节不对前端暴露
        continue;
      } else if (chunk.type === 'sources') {
        res.write(`data: ${JSON.stringify({ sources: chunk.sources })}\n\n`);
      } else if (chunk.type === 'trace') {
        const outcome = chunk.trace?.outcome || {};
        res.write(`data: ${JSON.stringify({
          traceId: chunk.trace?.traceId || req.traceId,
          rag: {
            usedRag: outcome.usedRag === true,
            usedParentChild: outcome.usedParentChild === true,
            matchedDocs: outcome.matchedDocs || 0,
            retrievedChunks: outcome.retrievedChunks || 0,
            fallbackReason: outcome.fallbackReason || null,
          },
        })}\n\n`);
      } else if (chunk.type === 'content') {
        if (chunk.done) {
          res.write('data: [DONE]\n\n');
        } else {
          res.write(`data: ${JSON.stringify({ content: chunk.content || '' })}\n\n`);
        }
      }
    }

    res.end();
  } catch (error) {
    console.error('[Chat Stream] 错误:', error);
    try {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    } catch (_) {
      // 连接已关闭，忽略
    }
  }
};

module.exports = { chatHandler, streamHandler };