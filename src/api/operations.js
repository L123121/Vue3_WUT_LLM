import { apiGet } from './client.js';

export const getOperationsDashboard = async () => {
  const response = await apiGet('/metrics/dashboard');
  return response.json();
};