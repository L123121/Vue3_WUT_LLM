"use strict";

const config = require('../config');
const { request, requestStream } = require('../utils/httpClient');
const { metrics } = require('./metrics.service');

/**
 * AI 服务
 *
 * 两种模式：
 *   1. OpenAI 兼容模式（默认）— /v2/chat/completions + Bearer 认证
 *   2. Anthropic 代理模式 — baseUrl 含 "/anthropic" 时，x-api-key + /v1/messages
 */
class AiService {
  constructor() {
    this.apiKey = config.ai.apiKey || '';
    this.baseUrl = config.ai.baseUrl || 'https://maas-api.cn-huabei-1.xf-yun.com/v2';
    this.model = config.ai.model || 'xopqwen36v35b';
    this.maxTokens = config.ai.maxTokens || 4000;
    this.temperature = config.ai.temperature || 0.7;
    this.timeout = config.ai.timeout || 60000;

    // 自动检测 Anthropic 代理模式
    this.anthropicMode = this.baseUrl.includes('/anthropic');
  }

  _buildHeaders(path) {
    if (this.anthropicMode) {
      return {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        ...(path.includes('/messages') ? { 'anthropic-version': '2023-06-01' } : {}),
      };
    }
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }

  _buildOptions(path, method = 'POST') {
    // 如果 baseUrl 已包含版本前缀（如 /v1），从请求路径中剥离版本号
    // StepFun: baseUrl=https://api.stepfun.com/v1, path=/v2/chat/completions → /chat/completions
    // iFlytek: baseUrl=https://maas-api...com, path=/v2/chat/completions → /v2/chat/completions
    let finalPath = path;
    const baseHasVersion = this.baseUrl.match(/\/v\d+$/);
    if (baseHasVersion) {
      finalPath = path.replace(/^\/v\d+/, '');
    }
    const fullUrl = this.baseUrl + finalPath;
    const urlObj = new URL(fullUrl);
    return {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: this._buildHeaders(path),
      timeout: this.timeout,
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

  _buildPayload(message, history, stream = false) {
    return {
      model: this.model,
      messages: this._buildMessages(message, history),
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      stream,
    };
  }

  // ========== 非流式 ==========

  async getCompletion(message, history = [], opts = {}) {
    if (!this.apiKey) {
      console.warn('[AI] API Key 缺失，使用模拟模式');
      return { content: this.getMockResponse(message), isMock: true };
    }

    const path = this.anthropicMode ? '/v1/messages' : '/v2/chat/completions';
    const payload = this._buildPayload(message, history, false);
    const body = JSON.stringify(payload);
    const options = this._buildOptions(path);
    options.headers['Content-Length'] = Buffer.byteLength(body, 'utf8');
    // 支持调用方覆盖超时时间
    if (opts.timeout) options.timeout = opts.timeout;

    console.log(`[AI] ${options.hostname}${options.path} model=${this.model} bodyLen=${body.length}`);

    try {
      const startTime = Date.now();
      const result = await request(options, body);
      const latency = Date.now() - startTime;
      metrics.recordLatency('ai', latency);

      let content = '';
      if (this.anthropicMode) {
        content = result.data?.content?.[0]?.text || '';
      } else {
        content = result.data?.choices?.[0]?.message?.content || '';
      }

      if (content) {
        console.log(`[AI] 响应 ${content.length} 字符`);
        return { content, isMock: false };
      } else {
        const msg = `AI 服务返回空响应: ${JSON.stringify(result.data).substring(0, 200)}`;
        console.warn('[AI]', msg);
        if (process.env.NODE_ENV === 'production') {
          throw new Error(msg);
        }
        return { content: this.getMockResponse(message), isMock: true };
      }
    } catch (err) {
      console.error(`[AI] 请求失败: ${err.message}`);
      // 生产环境：抛出错误让上游触发告警，不静默降级
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`AI 服务请求失败: ${err.message}`);
      }
      // 开发环境：返回 mock 响应以便调试
      return { content: this.getMockResponse(message), isMock: true };
    }
  }

  // ========== 流式 ==========

  async *getCompletionStream(message, history = []) {
    if (!this.apiKey) {
      const mock = this.getMockResponse(message);
      for (const c of mock) yield { content: c, done: false };
      yield { content: '', done: true };
      return;
    }

    const path = this.anthropicMode ? '/v1/messages' : '/v2/chat/completions';
    const payload = this._buildPayload(message, history, true);
    const body = JSON.stringify(payload);
    const options = this._buildOptions(path);
    options.headers['Content-Length'] = Buffer.byteLength(body, 'utf8');

    const streamStart = Date.now();
    console.log(`[AI 流式] ${options.hostname}${options.path} model=${this.model} bodyLen=${body.length}`);

    let res;
    try {
      res = await requestStream(options, body);
    } catch (err) {
      console.error('[AI 流式] 连接失败:', err.message);
      yield { content: `[连接失败: ${err.message}]`, done: false };
      yield { content: '', done: true };
      return;
    }

    if (res.statusCode !== 200) {
      let err = '';
      for await (const c of res) err += c;
      console.error(`[AI 流式] ${res.statusCode}: ${err.substring(0, 200)}`);
      yield { content: `[错误 ${res.statusCode}]`, done: false };
      yield { content: '', done: true };
      return;
    }

    yield* this._parseStream(res);

    // 流式结束后记录总延迟
    metrics.recordLatency('ai', Date.now() - streamStart);
  }

  async *_parseStream(res) {
    let buf = '';
    for await (const chunk of res) {
      buf += chunk.toString();
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
          if (this.anthropicMode) {
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
    yield { content: '', done: true };
  }

  getMockResponse(message) {
    return `收到您的问题："${message}"。AI 服务暂时不可用，请稍后再试。`;
  }
}

// 单例实例：全项目共享一个 AiService，复用配置和连接
const aiService = new AiService();

module.exports = { AiService, aiService, metrics };
