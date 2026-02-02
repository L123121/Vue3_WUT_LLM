import { Request, Response, NextFunction } from 'express';
import * as todoService from '../services/todo.service';
import { successResponse, errorResponse } from '../utils/response';

export const getAllTodos = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Assuming userId is attached to req by auth middleware (mocked here)
    const userId = 'u1'; 
    const todos = await todoService.getTodos(userId);
    successResponse(res, todos);
  } catch (error) {
    next(error);
  }
};

export const createTodo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = 'u1';
    const newTodo = await todoService.createTodo(userId, (req as any).body);
    successResponse(res, newTodo, 'Todo created');
  } catch (error) {
    next(error);
  }
};

export const toggleTodo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = (req as any).params;
    const todo = await todoService.updateTodo(id, { completed: (req as any).body.completed });
    
    if (!todo) {
      return errorResponse(res, 'Todo not found', 404);
    }
    
    successResponse(res, todo, 'Todo updated');
  } catch (error) {
    next(error);
  }
};

export const deleteTodo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = (req as any).params;
    const success = await todoService.deleteTodo(id);
    
    if (!success) {
      return errorResponse(res, 'Todo not found', 404);
    }
    
    successResponse(res, null, 'Todo deleted');
  } catch (error) {
    next(error);
  }
};