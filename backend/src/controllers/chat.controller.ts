import { Request, Response, NextFunction } from 'express';
import { ChatService } from '../services/chat.service';
import { XunfeiService } from '../services/xunfei.service';
import { successResponse } from '../utils/response';

const chatService = new ChatService();
const xunfeiService = new XunfeiService();

export const chat = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, history } = (req as any).body;
    
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
export const chatStream = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, history } = (req as any).body;
    
    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 禁用 nginx 缓冲
    res.flushHeaders();

    // 流式输出
    for await (const chunk of xunfeiService.getCompletionStream(message, history || [])) {
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