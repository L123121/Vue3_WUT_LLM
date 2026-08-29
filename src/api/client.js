const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const API_URL = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;

// 默认请求超时（毫秒），流式请求可通过 options.timeout 覆盖
const DEFAULT_TIMEOUT = 30000;

const fetchOpts = {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'include',
};

let authErrorHandler = null;

export const configureAuthErrorHandler = (handler) => {
  authErrorHandler = typeof handler === 'function' ? handler : null;
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
      void handleAuthError();
    }

    const error = new Error(errorMessage);
    error.status = response.status;
    throw error;
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
  // ⚠️ 不清除会话缓存（chat_cache:<userId>）：401 时无法完成同步，
  // 缓存里可能留着未上传消息的唯一副本，保留到下次该用户登录后再迁移。
  localStorage.removeItem('chat_current_conversation_id');
  await authErrorHandler?.();
};

/**
 * 构建 fetch options，合并默认凭据配置 + 超时控制
 */
const buildFetchOptions = (method, extraHeaders = {}, body, options = {}) => {
  const { timeout, signal, ...rest } = options;
  delete rest.headers;
  return {
    ...fetchOpts,
    method,
    headers: {
      ...fetchOpts.headers,
      ...extraHeaders,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: signal || AbortSignal.timeout(timeout || DEFAULT_TIMEOUT),
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

export { API_BASE, API_URL, fetchOpts, DEFAULT_TIMEOUT };
