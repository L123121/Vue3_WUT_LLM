import { Request, Response, NextFunction } from 'express';
import * as chatService from '../services/xunfei.service';
import { successResponse } from '../utils/response';

export const chat = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, history } = (req as any).body;
    
    if (!message) {
      throw new Error('Message is required');
    }

    const reply = await chatService.getCompletion(message, history || []);
    successResponse(res, { reply }, 'Message processed');
  } catch (error) {
    next(error);
  }
};