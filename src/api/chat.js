const API_URL = '/api';
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30000;
const HEARTBEAT_INTERVAL = 30000;
const HEARTBEAT_TIMEOUT = 10000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 获取认证头
const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
};

// 指数退避延迟
const getExponentialDelay = (attempt) => {
  const delayMs = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt), MAX_RETRY_DELAY);
  return delayMs + Math.random() * 1000; // 添加随机抖动
};

// 连接状态管理
export const connectionManager = {
  isConnected: true,
  lastHeartbeat: Date.now(),
  pendingMessages: [],
  listeners: new Set(),

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  },

  notify(event, data) {
    this.listeners.forEach(cb => cb(event, data));
  },

  setConnected(connected) {
    const wasConnected = this.isConnected;
    this.isConnected = connected;
    if (wasConnected !== connected) {
      this.notify(connected ? 'connected' : 'disconnected');
    }
  },

  addPendingMessage(message) {
    this.pendingMessages.push({ ...message, timestamp: Date.now() });
    this.savePendingMessages();
  },

  removePendingMessage(id) {
    this.pendingMessages = this.pendingMessages.filter(m => m.id !== id);
    this.savePendingMessages();
  },

  savePendingMessages() {
    try {
      localStorage.setItem('pending_messages', JSON.stringify(this.pendingMessages));
    } catch (e) {
      console.warn('Failed to save pending messages:', e);
    }
  },

  loadPendingMessages() {
    try {
      const stored = localStorage.getItem('pending_messages');
      if (stored) {
        this.pendingMessages = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Failed to load pending messages:', e);
    }
  },

  clearPendingMessages() {
    this.pendingMessages = [];
    localStorage.removeItem('pending_messages');
  }
};

// 心跳检测
let heartbeatTimer = null;
let heartbeatCheckTimer = null;

const startHeartbeat = () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  heartbeatTimer = setInterval(async () => {
    if (!connectionManager.isConnected) return;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT);

      const response = await fetch(`${API_URL}/health`, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        connectionManager.lastHeartbeat = Date.now();
        connectionManager.setConnected(true);
      } else {
        connectionManager.setConnected(false);
      }
    } catch (error) {
      console.warn('Heartbeat failed:', error.message);
      connectionManager.setConnected(false);
    }
  }, HEARTBEAT_INTERVAL);
};

// 初始化连接管理
connectionManager.loadPendingMessages();
startHeartbeat();

export const sendMessageToBackend = async (message, history = [], retries = MAX_RETRIES) => {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ message, history }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    connectionManager.setConnected(true);
    return data.data.reply || '抱歉，我没有收到回复。';
  } catch (error) {
    console.error('Chat API Error:', error);
    connectionManager.setConnected(false);

    if (retries > 0) {
      const retryDelay = getExponentialDelay(MAX_RETRIES - retries);
      console.log(`Retrying in ${retryDelay}ms... (${retries} attempts left)`);
      await delay(retryDelay);
      return sendMessageToBackend(message, history, retries - 1);
    }
    throw error;
  }
};

export const sendMessageStream = async (message, history = [], callbacks, options = {}) => {
  const controller = options.signal ? { abort: () => {} } : new AbortController();
  const signal = options.signal || controller.signal;
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const attempt = options.attempt ?? 0;
  const conversationId = options.conversationId;
  const enableRag = options.enableRag ?? false;

  // 添加到待发送队列
  const messageId = `msg_${Date.now()}`;
  if (attempt === 0) {
    connectionManager.addPendingMessage({ id: messageId, message, history, conversationId });
  }

    // 直接按后端 chunk 渲染，避免批量合并导致体感过快
  const flushImmediately = () => {};


  try {
    const response = await fetch(`${API_URL}/stream`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ message, history, conversationId, enableRag }),
      signal,
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    if (!response.body) throw new Error('Response body is null');

    connectionManager.setConnected(true);
    connectionManager.removePendingMessage(messageId);

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        flushImmediately(); // 流结束，立即刷新剩余内容
        callbacks.onDone();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          flushImmediately(); // 收到结束标记，立即刷新
          callbacks.onDone();
          return;
        }

        try {
          const json = JSON.parse(data);
          if (json.content) callbacks.onChunk(json.content);
          if (json.sources) callbacks.onSources?.(json.sources);
          if (json.error) {
            flushImmediately();
            callbacks.onError(new Error(json.error));
            return;
          }
        } catch (parseError) {
          console.warn('[SSE] Parse error for data:', data, parseError);
        }
      }
    }
  } catch (error) {
    console.error('Stream API Error:', error);
    connectionManager.setConnected(false);
    flushImmediately(); // 出错时也要刷新，避免内容丢失

    if (error.name === 'AbortError') {
      flushImmediately();
      connectionManager.removePendingMessage(messageId);
      callbacks.onAbort?.();
      return;
    }

    // 指数退避重连
    if (attempt < maxRetries) {
      const retryDelay = getExponentialDelay(attempt);
      console.log(`Stream reconnecting in ${retryDelay}ms... (attempt ${attempt + 1}/${maxRetries})`);
      callbacks.onRetry?.(attempt + 1, maxRetries, retryDelay);
      await delay(retryDelay);
      return sendMessageStream(message, history, callbacks, { ...options, attempt: attempt + 1, maxRetries });
    }

    connectionManager.removePendingMessage(messageId);
    callbacks.onError(error);
  }
};

export const createStreamRequest = (message, history = [], callbacks) => {
  const abortController = new AbortController();

  const execute = async () => {
    try {
      const response = await fetch(`${API_URL}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
        signal: abortController.signal,
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      if (!response.body) throw new Error('Response body is null');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          callbacks.onDone();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            callbacks.onDone();
            return;
          }
          try {
            const json = JSON.parse(data);
            if (json.content) callbacks.onChunk(json.content);
          } catch {
            // Ignore malformed chunks.
          }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') callbacks.onError(error);
    }
  };

  return { execute, abort: () => abortController.abort() };
};

export const fetchUsageStats = async (hours = 24) => {
  const response = await fetch(`${API_URL}/usage?hours=${hours}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Usage API error: ${response.status}`);
  }

  const payload = await response.json();
  if (!payload?.success) {
    throw new Error(payload?.error || 'Failed to fetch usage data');
  }

  return payload.data;
};

// 生成会话标题
export const generateTitle = async (message) => {
  try {
    const response = await fetch(`${API_URL}/title`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.title || message.slice(0, 18);
  } catch (error) {
    console.error('Generate title error:', error);
    // 降级：返回消息前18个字符
    return message.slice(0, 18);
  }
};


