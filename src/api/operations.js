import { apiGet, apiPost } from './client.js';

export const getOperationsDashboard = async () => {
  const response = await apiGet('/metrics/dashboard');
  return response.json();
};

export const createKnowledgeTask = async (payload) => {
  const response = await apiPost('/metrics/risk-audit/tasks', payload);
  return response.json();
};
