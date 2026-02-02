import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service';
import { successResponse } from '../utils/response';

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = (req as any).body;
    
    if (!username || !password) {
      throw new Error('Username and password are required');
    }

    const result = await authService.login(username, password);
    successResponse(res, result, 'Login successful');
  } catch (error) {
    next(error);
  }
};