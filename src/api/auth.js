import { apiPost } from './client.js';

export const login = async (data) => {
  const response = await apiPost('/auth/login', data);

  if (!response.ok) {
    throw new Error('Login failed');
  }

  return response.json();
};
