"use strict";

const { StringDecoder } = require('string_decoder');
const config = require('../config');
const { request, requestStream } = require('../utils/httpClient');
const { metrics } = require('./metrics.service');

// ==================== 请求队列（API 并发限流） ====================
// 防止 LLM API 限流（429 Too Many Requests），控制同时发往 API 的请求数量。
// 多余的请求排队等待，而非直接报错。

const LLM_CONCURRENCY = parseInt(process.env.LLM_CONCURRENCY || '3', 10);

class RequestQueue {
  constructor(maxConcurrent) {
    this._max = maxConcurrent;
    this._running = 0;
    this._waiters = [];
  }

  /**
   * 获取一个执行槽位。返回 release 函数，调用后释放槽位。
   * 用法：
   *   const release = await queue.acquire();
   *   try { /* ... 调用 API ... *\/ } finally { release(); }
   */
  acquire() {
    if (this._running < this._max) {
      this._running++;
      return Promise.resolve(this._release());
    }
    return new Promise(resolve => {
      this._waiters.push(resolve);
    });
  }

  _release() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._running--;
      if (this._waiters.length > 0) {
        const next = this._waiters.shift();
        this._running++;
        next(this._release());
      }
    };
  }

  get pending() { return this._waiters.length; }
  get running() { return this._running; }
}

const llmQueue = new RequestQueue(LLM_CONCURRENCY);

// ==================== AI 服务 ====================

/**
 * AI 服务（主备双 provider）
 *
 * 主 provider（StepFun 等）失败时自动切换到备用 provider（如 LongCat）。
 *
 * 两种模式：
 *   1. OpenAI 兼容模式（默认）— /v2/chat/completions + Bearer 认证
 *   2. Anthropic 代理模式 — baseUrl 含 "/anthropic" 时，x-api-key + /v1/messages
 *
 * 请求队列：所有 LLM API 调用（含流式）经过 llmQueue，控制并发，
 * 避免触发 API 提供商的速率限制（429）。
 */
class AiService {
  constructor() {
    this.primary = this._normalizeProvider(config.ai);
    // 备用 provider：有 apiKey 时才启用
    this.fallback = config.ai.fallback?.apiKey
      ? this._normalizeProvider(config.ai.fallback)
      : null;
  }

  _normalizeProvider(cfg) {
    const baseUrl = cfg.baseUrl || 'https://api.stepfun.com/v1';
    return {
      apiKey: cfg.apiKey || '',
      baseUrl,
      model: cfg.model || 'step-3.7-flash',
      maxTokens: cfg.maxTokens || 4000,
      temperature: cfg.temperature || 0.7,
      timeout: cfg.timeout || 60000,
      anthropicMode: baseUrl.includes('/anthropic'),
    };
  }

  _hasKey() {
    return !!(this.primary.apiKey || (this.fallback && this.fallback.apiKey));
  }

  _buildHeaders(path, provider) {
    if (provider.anthropicMode) {
      return {
        'Content-Type': 'application/json; charset=utf-8',
        'x-api-key': provider.apiKey,
        ...(path.includes('/messages') ? { 'anthropic-version': '2023-06-01' } : {}),
      };
    }
    return {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${provider.apiKey}`,
    };
  }

  _buildOptions(path, provider) {
    // 如果 baseUrl 已包含版本前缀（如 /v1），从请求路径中剥离版本号
    // StepFun: baseUrl=https://api.stepfun.com/v1, path=/v2/chat/completions → /chat/completions
    // LongCat: baseUrl=https://api.longcat.chat/openai, path=/v2/chat/completions → /v2/chat/completions
    let finalPath = path;
    const baseHasVersion = provider.baseUrl.match(/\/v\d+$/);
    if (baseHasVersion) {
      finalPath = path.replace(/^\/v\d+/, '');
    }
    const fullUrl = provider.baseUrl + finalPath;
    const urlObj = new URL(fullUrl);
    return {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: this._buildHeaders(path, provider),
      timeout: provider.timeout,
    };
  }

  _buildMessages(message, history = []) {
    return [
      ...history.map(h => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.content,
      })),
      { role: 'user', content: message },
    ];
  }

  // ========== 非流式（经队列） ==========

  async getCompletion(message, history = [], opts = {}) {
    if (!this._hasKey()) {
      console.warn('[AI] API Key 缺失，使用模拟模式');
      return { content: this.getMockResponse(message), isMock: true, model: 'mock', usage: null };
    }

    const release = await llmQueue.acquire();
    console.log(`[AI 队列] 获取到槽位，队列中待处理: ${llmQueue.pending}`);
    try {
      return await this._doGetCompletion(message, history, opts);
    } finally {
      release();
    }
  }

  async _doGetCompletion(message, history = [], opts = {}) {
    // 先尝试主 provider
    try {
      return await this._requestProvider(this.primary, message, history, opts);
    } catch (err) {
      if (!this.fallback) throw err;
      console.warn(`[AI] 主 provider 失败 (${err.message})，切换到备用 provider`);
      return await this._requestProvider(this.fallback, message, history, opts);
    }
  }

  async _requestProvider(provider, message, history, opts) {
    const path = provider.anthropicMode ? '/v1/messages' : '/v2/chat/completions';
    const payload = {
      model: provider.model,
      messages: this._buildMessages(message, history),
      max_tokens: provider.maxTokens,
      temperature: provider.temperature,
      stream: false,
    };
    const body = JSON.stringify(payload);
    const options = this._buildOptions(path, provider);
    options.headers['Content-Length'] = Buffer.byteLength(body, 'utf8');
    // 支持调用方覆盖超时时间和重试次数
    if (opts.timeout) options.timeout = opts.timeout;
    if (opts.retries !== undefined) options.retries = opts.retries;

    console.log(`[AI] ${options.hostname}${options.path} model=${provider.model} bodyLen=${body.length}`);

    const startTime = Date.now();
    const result = await request(options, body);
    const latency = Date.now() - startTime;
    metrics.recordLatency('ai', latency);

    let content = '';
    if (provider.anthropicMode) {
      content = result.data?.content?.[0]?.text || '';
    } else {
      content = result.data?.choices?.[0]?.message?.content || '';
    }

    if (content) {
      console.log(`[AI] 响应 ${content.length} 字符`);
      return { content, isMock: false, model: result.data?.model || provider.model, usage: result.data?.usage || null };
    } else {
      const msg = `AI 服务返回空响应: ${JSON.stringify(result.data).substring(0, 200)}`;
      console.warn('[AI]', msg);
      // 空响应视为可恢复错误，抛出后触发 fallback
      throw new Error(msg);
    }
  }

  // ========== 流式（经队列） ==========

  async *getCompletionStream(message, history = []) {
    if (!this._hasKey()) {
      const mock = this.getMockResponse(message);
      for (const c of mock) yield { content: c, done: false };
      yield { content: '', done: true };
      return;
    }

    // 排队等待 LLM 槽位，整个流式过程占用一个槽位
    const release = await llmQueue.acquire();
    console.log(`[AI 队列] 流式获取到槽位，队列中待处理: ${llmQueue.pending}`);

    try {
      yield* this._doGetCompletionStream(message, history);
    } finally {
      release();
    }
  }

  async *_doGetCompletionStream(message, history = []) {
    // 主 provider 连接建立前失败时，可切换到备用 provider
    if (this.fallback) {
      try {
        yield* this._streamProvider(this.primary, message, history);
        return; // 主 provider 成功完成
      } catch (err) {
        console.warn(`[AI 流式] 主 provider 失败 (${err.message})，切换到备用 provider`);
      }
      // 主 provider 失败，尝试备用
      yield* this._streamProvider(this.fallback, message, history);
    } else {
      yield* this._streamProvider(this.primary, message, history);
    }
  }

  async *_streamProvider(provider, message, history) {
    const path = provider.anthropicMode ? '/v1/messages' : '/v2/chat/completions';
    const payload = {
      model: provider.model,
      messages: this._buildMessages(message, history),
      max_tokens: provider.maxTokens,
      temperature: provider.temperature,
      stream: true,
    };
    const body = JSON.stringify(payload);
    const options = this._buildOptions(path, provider);
    options.headers['Content-Length'] = Buffer.byteLength(body, 'utf8');

    const streamStart = Date.now();
    console.log(`[AI 流式] ${options.hostname}${options.path} model=${provider.model} bodyLen=${body.length}`);

    let res;
    try {
      res = await requestStream(options, body);
    } catch (err) {
      // 连接建立前失败 → 抛出，让外层决定是否 fallback
      throw new Error(`连接失败: ${err.message}`);
    }

    if (res.statusCode !== 200) {
      let err = '';
      for await (const c of res) err += c;
      throw new Error(`HTTP ${res.statusCode}: ${err.substring(0, 200)}`);
    }

    yield* this._parseStream(res, provider);

    metrics.recordLatency('ai', Date.now() - streamStart);
  }

  async *_parseStream(res, provider) {
    let buf = '';
    const decoder = new StringDecoder('utf8');
    for await (const chunk of res) {
      buf += decoder.write(chunk);
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith('event:')) continue;
        if (!t.startsWith('data:')) continue;
        const d = t.slice(5).trim();
        if (d === '[DONE]') { yield { content: '', done: true }; return; }
        try {
          const j = JSON.parse(d);
          let content = '';
          let done = false;
          if (provider.anthropicMode) {
            if (j.type === 'content_block_delta' && j.delta?.text) content = j.delta.text;
            if (j.type === 'message_stop' || j.type === 'message_delta') done = true;
          } else {
            content = j.choices?.[0]?.delta?.content || '';
          }
          if (content) yield { content, done: false };
          if (done) { yield { content: '', done: true }; return; }
        } catch (err) {
          console.warn('[AI 流式] SSE 解析失败:', err.message);
        }
      }
    }
    // 冲刷 decoder 中残留的不完整多字节序列
    buf += decoder.end();
    if (buf.trim()) {
      const t = buf.trim();
      if (t.startsWith('data:') && t.slice(5).trim() !== '[DONE]') {
        try {
          const j = JSON.parse(t.slice(5).trim());
          const content = provider.anthropicMode
            ? (j.delta?.text || '')
            : (j.choices?.[0]?.delta?.content || '');
          if (content) yield { content, done: false };
        } catch (_) { /* ignore */ }
      }
    }
    yield { content: '', done: true };
  }

  getMockResponse(message) {
    return `收到您的问题："${message}"。AI 服务暂时不可用，请稍后再试。`;
  }
}

// 单例实例：全项目共享一个 AiService，复用配置和连接
const aiService = new AiService();

module.exports = { AiService, aiService, metrics };
