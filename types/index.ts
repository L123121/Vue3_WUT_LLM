export enum Tab {
  HOME = 'HOME',
  TODO = 'TODO',
  ABOUT = 'ABOUT',
  AI_CHAT = 'AI_CHAT',
  SETTINGS = 'SETTINGS',
}

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  category: 'academic' | 'personal' | 'urgent';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
  isError?: boolean;
}

export interface User {
  id: string;
  name: string;
  avatar: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'error';
  timestamp: Date;
  read: boolean;
}
