import { Todo } from '../models/todo.model';

// In-memory storage for demonstration
let todos: Todo[] = [
  { 
    id: '1', 
    text: '完成 Vue 3 重构', 
    completed: false, 
    category: 'academic', 
    userId: 'u1',
    createdAt: new Date() 
  },
  { 
    id: '2', 
    text: '预约图书馆研讨间', 
    completed: true, 
    category: 'personal', 
    userId: 'u1',
    createdAt: new Date() 
  }
];

export const getTodos = async (userId: string): Promise<Todo[]> => {
  return todos.filter(t => t.userId === userId);
};

export const createTodo = async (userId: string, data: Partial<Todo>): Promise<Todo> => {
  const newTodo: Todo = {
    id: Date.now().toString(),
    text: data.text || '',
    completed: false,
    category: data.category || 'personal',
    userId,
    createdAt: new Date()
  };
  todos.unshift(newTodo);
  return newTodo;
};

export const updateTodo = async (id: string, updates: Partial<Todo>): Promise<Todo | undefined> => {
  const index = todos.findIndex(t => t.id === id);
  if (index === -1) return undefined;
  
  todos[index] = { ...todos[index], ...updates };
  return todos[index];
};

export const deleteTodo = async (id: string): Promise<boolean> => {
  const initialLength = todos.length;
  todos = todos.filter(t => t.id !== id);
  return todos.length !== initialLength;
};