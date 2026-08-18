import { API_URL, handleAuthError } from './client.js';

export const synthesizeSpeech = async (text, options = {}) => {
  const response = await fetch(`${API_URL}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ text }),
    signal: options.signal,
  });

  if (!response.ok) {
    let message = `语音生成失败（${response.status}）`;
    try {
      const data = await response.json();
      message = data.error || data.message || message;
    } catch {
      // 非 JSON 错误响应使用默认提示
    }
    if (response.status === 401) await handleAuthError();
    throw new Error(message);
  }

  return response.blob();
};
