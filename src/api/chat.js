const API_URL = '/api';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const sendMessageToBackend = async (message, history = [], retries = MAX_RETRIES) => {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.data.reply || '抱歉，我没有收到回复。';
  } catch (error) {
    console.error('Chat API Error:', error);
    if (retries > 0) {
      await delay(RETRY_DELAY);
      return sendMessageToBackend(message, history, retries - 1);
    }
    throw error;
  }
};

export const sendMessageStream = async (message, history = [], callbacks, retries = MAX_RETRIES) => {
  const controller = new AbortController();

  try {
    const response = await fetch(`${API_URL}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
      signal: controller.signal,
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
          if (json.error) {
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
    if (retries > 0 && error.name !== 'AbortError') {
      await delay(RETRY_DELAY);
      return sendMessageStream(message, history, callbacks, retries - 1);
    }
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
