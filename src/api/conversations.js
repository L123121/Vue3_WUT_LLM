import { apiGet, apiPost, apiPut, apiDelete } from './client.js';

/**
 * 获取用户所有会话
 */
export const fetchConversations = async () => {
  const response = await apiGet('/conversations');
  if (!response.ok) return [];
  const data = await response.json();
  return data.data || [];
};

/**
 * 创建新会话
 */
export const createConversation = async (title = '新会话') => {
  const response = await apiPost('/conversations', { title });
  if (!response.ok) throw new Error('创建会话失败');
  const data = await response.json();
  return data.data;
};

/**
 * 获取单个会话详情
 */
export const fetchConversation = async (conversationId) => {
  const response = await apiGet(`/conversations/${conversationId}`);
  if (!response.ok) return null;
  const data = await response.json();
  return data.data;
};

/**
 * 重命名会话
 */
export const renameConversation = async (conversationId, title) => {
  const response = await apiPut(`/conversations/${conversationId}`, { title });
  if (!response.ok) return false;
  return true;
};

/**
 * 删除会话
 */
export const deleteConversation = async (conversationId) => {
  const response = await apiDelete(`/conversations/${conversationId}`);
  if (!response.ok) return false;
  return true;
};

/**
 * 清空会话消息
 */
export const clearConversationMessages = async (conversationId) => {
  const response = await apiDelete(`/conversations/${conversationId}/messages`);
  if (!response.ok) return false;
  return true;
};
