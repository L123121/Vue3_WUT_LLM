/**
 * RAG 评测 API 请求封装
 * 复用项目现有的后端接口和 LLM API
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../backend/.env') });
config({ path: resolve(__dirname, '../../../.env') });

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const AI_BASE_URL = process.env.AI_BASE_URL || 'https://maas-api.cn-huabei-1.xf-yun.com/v2';
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'xopqwen36v35b';

/**
 * 调用 RAG 流式接口，返回完整回答和来源
 * @param {string} question - 用户问题
 * @param {Array} history - 对话历史
 * @returns {Promise<{answer: string, sources: Array}>}
 */
export async function ragQuery(question, history = []) {
  const response = await fetch(`${BACKEND_URL}/api/rag/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: question, history })
  });

  if (!response.ok) {
    throw new Error(`RAG API 请求失败: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const lines = text.split('\n').filter(line => line.startsWith('data: '));

  let answer = '';
  let sources = [];

  for (const line of lines) {
    const data = line.slice(6).trim();
    if (data === '[DONE]') continue;

    try {
      const parsed = JSON.parse(data);
      if (parsed.sources) sources = parsed.sources;
      if (parsed.content) answer += parsed.content;
      if (parsed.error) throw new Error(`RAG 返回错误: ${parsed.error}`);
    } catch (e) {
      if (e.message.includes('RAG 返回错误')) throw e;
      // 跳过解析错误
    }
  }

  return { answer, sources };
}

/**
 * 获取知识库文档列表
 * @returns {Promise<Array>}
 */
export async function listDocuments() {
  const response = await fetch(`${BACKEND_URL}/api/rag/documents`);
  if (!response.ok) throw new Error(`获取文档列表失败: ${response.status}`);
  const result = await response.json();
  return result.data?.documents || [];
}

/**
 * 获取文档详情（含内容）
 * @param {string} docId
 * @returns {Promise<Object>}
 */
export async function getDocument(docId) {
  const response = await fetch(`${BACKEND_URL}/api/rag/documents/${docId}`);
  if (!response.ok) throw new Error(`获取文档详情失败: ${response.status}`);
  const result = await response.json();
  return result.data;
}

/**
 * 调用 LLM（OpenAI 兼容接口），用于 RAGAS judge
 * @param {string} systemPrompt - 系统提示
 * @param {string} userMessage - 用户消息
 * @param {Object} options - 配置项
 * @returns {Promise<string>}
 */
export async function llmJudge(systemPrompt, userMessage, options = {}) {
  const { temperature = 0, maxTokens = 2000 } = options;

  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AI_API_KEY}`
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature,
      max_tokens: maxTokens
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LLM API 请求失败: ${response.status} ${errText.substring(0, 200)}`);
  }

  const result = await response.json();
  return result.choices?.[0]?.message?.content || '';
}

/**
 * 带重试的请求封装
 * @param {Function} fn - 要执行的异步函数
 * @param {number} maxRetries - 最大重试次数
 * @param {number} delayMs - 重试间隔
 * @returns {Promise<*>}
 */
export async function withRetry(fn, maxRetries = 3, delayMs = 2000) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries) throw err;
      console.warn(`  [重试 ${i + 1}/${maxRetries}] ${err.message}`);
      await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
}

/**
 * 检查后端是否可用
 * @returns {Promise<boolean>}
 */
export async function checkBackendHealth() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}

export { BACKEND_URL, AI_BASE_URL, AI_API_KEY, AI_MODEL };
