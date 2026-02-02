export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  category: 'academic' | 'personal' | 'urgent';
  userId: string;
  createdAt: Date;
}