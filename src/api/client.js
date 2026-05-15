const API_URL = '/api';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
};

const handleResponse = async (response) => {
  return response;
};

// 仅在需要时手动调用，用于全局认证过期处理
export const handleAuthError = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login';
};

export const apiGet = async (path, options = {}) => {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'GET',
    headers: getAuthHeaders(),
    ...options,
  });
  return handleResponse(response);
};

export const apiPost = async (path, body, options = {}) => {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
    ...options,
  });
  return handleResponse(response);
};

export const apiPut = async (path, body, options = {}) => {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
    ...options,
  });
  return handleResponse(response);
};

export const apiDelete = async (path, options = {}) => {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
    ...options,
  });
  return handleResponse(response);
};

// 无 JSON 序列化的 POST（用于流式请求等自定义场景）
export const apiPostRaw = async (path, body, options = {}) => {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    ...options,
  });
  return handleResponse(response);
};

export { API_URL, getAuthHeaders };
