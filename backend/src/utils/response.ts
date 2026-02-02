import { Response } from 'express';

export const successResponse = (res: Response, data: any, message: string = 'Success') => {
  return (res as any).status(200).json({
    success: true,
    message,
    data,
  });
};

export const errorResponse = (res: Response, message: string = 'Error', statusCode: number = 500) => {
  return (res as any).status(statusCode).json({
    success: false,
    message,
  });
};