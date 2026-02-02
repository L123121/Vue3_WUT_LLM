import { User } from '../models/user.model';

// Mock database
const users: User[] = [
  {
    id: 'u1',
    username: '2021001',
    name: '武理学子',
    avatar: 'https://api.dicebear.com/7.x/notionists/svg?seed=Felix',
    role: 'student'
  }
];

export const login = async (username: string, password: string): Promise<{ user: User; token: string }> => {
  // In a real application, you would verify the password hash against the database
  if (password !== '123456') {
    throw new Error('Invalid credentials');
  }

  const user = users.find(u => u.username === username) || {
    id: 'u1',
    username,
    name: '武理学子',
    avatar: 'https://api.dicebear.com/7.x/notionists/svg?seed=Felix',
    role: 'student'
  };

  // Mock JWT token generation
  const token = 'mock_jwt_token_' + Date.now();

  return { user, token };
};