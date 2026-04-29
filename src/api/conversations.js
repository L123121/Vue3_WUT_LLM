const API_URL = '/api';

// 获取认证头
const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  console.log('[API] Token from localStorage:', token ? 'exists' : 'missing');
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
};

/**
 * 获取用户所有会话
 */
export const fetchConversations = async () => {
  const response = await fetch(`${API_URL}/conversations`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(`获取会话列表失败: ${response.status}`);
  }

  const data = await response.json();
  return data.data || [];
};

/**
 * 创建新会话
 */
export const createConversation = async (title = '新会话') => {
  const response = await fetch(`${API_URL}/conversations`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    throw new Error(`创建会话失败: ${response.status}`);
  }

  const data = await response.json();
  return data.data;
};

/**
 * 获取单个会话详情
 */
export const fetchConversation = async (conversationId) => {
  const response = await fetch(`${API_URL}/conversations/${conversationId}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(`获取会话详情失败: ${response.status}`);
  }

  const data = await response.json();
  return data.data;
};

/**
 * 重命名会话
 */
export const renameConversation = async (conversationId, title) => {
  const response = await fetch(`${API_URL}/conversations/${conversationId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    throw new Error(`重命名会话失败: ${response.status}`);
  }

  return true;
};

/**
 * 删除会话
 */
export const deleteConversation = async (conversationId) => {
  const response = await fetch(`${API_URL}/conversations/${conversationId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(`删除会话失败: ${response.status}`);
  }

  return true;
};

/**
 * 清空会话消息
 */
export const clearConversationMessages = async (conversationId) => {
  const response = await fetch(`${API_URL}/conversations/${conversationId}/messages`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(`清空消息失败: ${response.status}`);
  }

  return true;
};
