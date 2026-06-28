const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const API_URL = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;

const fetchOpts = {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'include',
};

const handleResponse = async (response) => {
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorData.error || errorMessage;
    } catch (err) {
      console.warn('[API] 响应 JSON 解析失败:', err.message);
    }

    // 401 未授权 - 清除本地用户信息并跳转登录
    if (response.status === 401) {
      handleAuthError();
    }

    throw new Error(errorMessage);
  }
  return response;
};

// 仅在需要时手动调用，用于全局认证过期处理
export const handleAuthError = async () => {
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // 登出请求失败不影响本地清理
  }
  localStorage.removeItem('user');
  window.location.href = '/login';
};

/**
 * 构建 fetch options，合并默认凭据配置
 */
const buildFetchOptions = (method, extraHeaders = {}, body, options = {}) => {
  const { headers: _ignored, ...rest } = options;
  return {
    ...fetchOpts,
    method,
    headers: {
      ...fetchOpts.headers,
      ...extraHeaders,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...rest,
  };
};

export const apiGet = async (path, options = {}) => {
  const response = await fetch(`${API_URL}${path}`,
    buildFetchOptions('GET', options.headers, undefined, options));
  return handleResponse(response);
};

export const apiPost = async (path, body, options = {}) => {
  const response = await fetch(`${API_URL}${path}`,
    buildFetchOptions('POST', options.headers, body, options));
  return handleResponse(response);
};

export const apiPut = async (path, body, options = {}) => {
  const response = await fetch(`${API_URL}${path}`,
    buildFetchOptions('PUT', options.headers, body, options));
  return handleResponse(response);
};

export const apiDelete = async (path, options = {}) => {
  const response = await fetch(`${API_URL}${path}`,
    buildFetchOptions('DELETE', options.headers, undefined, options));
  return handleResponse(response);
};

// 无 JSON 序列化的 POST（用于流式请求等自定义场景）
export const apiPostRaw = async (path, body, options = {}) => {
  const { headers: _ignored, ...rest } = options;
  const fetchOpts = {
    ...fetchOpts,
    method: 'POST',
    headers: {
      ...fetchOpts.headers,
      ...(options.headers || {}),
    },
    ...rest,
  };
  if (body !== undefined) fetchOpts.body = JSON.stringify(body);
  const response = await fetch(`${API_URL}${path}`, fetchOpts);
  return handleResponse(response);
};

export { API_BASE, API_URL, fetchOpts };
