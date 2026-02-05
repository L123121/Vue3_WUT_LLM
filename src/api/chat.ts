const API_URL = '/api';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

/**
 * 延迟函数
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 普通请求（带重试机制）
 */
export const sendMessageToBackend = async (
  message: string,
  history: { role: string; content: string }[] = [],
  retries = MAX_RETRIES
): Promise<string> => {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        history
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.data.reply || "抱歉，我没有收到回复。";
  } catch (error) {
    console.error("Chat API Error:", error);
    if (retries > 0) {
      console.log(`重试中... 剩余重试次数: ${retries}`);
      await delay(RETRY_DELAY);
      return sendMessageToBackend(message, history, retries - 1);
    }
    throw error;
  }
};

/**
 * SSE 流式请求回调类型
 */
export interface StreamCallbacks {
  onChunk: (content: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
}

/**
 * SSE 流式请求（基于 ReadableStream + TextDecoder）
 * 支持异常重试机制
 */
export const sendMessageStream = async (
  message: string,
  history: { role: string; content: string }[] = [],
  callbacks: StreamCallbacks,
  retries = MAX_RETRIES
): Promise<void> => {
  const controller = new AbortController();
  const { signal } = controller;

  try {
    const response = await fetch(`${API_URL}/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, history }),
      signal
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

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
          // console.log('[SSE] Received chunk:', json);
          if (json.content) {
            callbacks.onChunk(json.content);
          }
          if (json.error) {
            callbacks.onError(new Error(json.error));
            return;
          }
        } catch (parseError) {
          console.warn('[SSE] Parse error for data:', data, parseError);
          // Skip malformed JSON chunks
        }
      }
    }
  } catch (error: any) {
    console.error('Stream API Error:', error);
    
    // 重试机制
    if (retries > 0 && error.name !== 'AbortError') {
      console.log(`流式请求重试中... 剩余重试次数: ${retries}`);
      await delay(RETRY_DELAY);
      return sendMessageStream(message, history, callbacks, retries - 1);
    }
    
    callbacks.onError(error);
  }
};

/**
 * 创建可取消的流式请求
 */
export const createStreamRequest = (
  message: string,
  history: { role: string; content: string }[] = [],
  callbacks: StreamCallbacks
) => {
  const abortController = new AbortController();
  
  const execute = async () => {
    try {
      const response = await fetch(`${API_URL}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message, history }),
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

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
            if (json.content) {
              callbacks.onChunk(json.content);
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        callbacks.onError(error);
      }
    }
  };

  return {
    execute,
    abort: () => abortController.abort()
  };
};