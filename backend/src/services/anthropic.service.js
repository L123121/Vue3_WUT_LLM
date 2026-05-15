"use strict";

const https = require('https');
const { URL } = require('url');
const config = require('../config');

class AnthropicService {
  constructor() {
    this.authToken = config.anthropic.authToken;
    this.baseUrl = config.anthropic.baseUrl;
    this.model = config.anthropic.model || 'mimo-v2.5';
    this.maxTokens = config.anthropic.maxTokens || 4000;
    this.temperature = config.anthropic.temperature || 0.7;
    this.timeout = config.anthropic.timeout || 60000;
  }

  /**
   * 构建请求选项
   */
  _buildOptions(path, method = 'POST') {
    const urlObj = new URL(this.baseUrl);
    return {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.authToken,
        'anthropic-version': '2023-06-01'
      },
      timeout: this.timeout
    };
  }

  /**
   * 非流式请求
   */
  async getCompletion(message, history = []) {
    if (!this.authToken) {
      console.warn('[Anthropic] Auth token 缺失，使用模拟模式');
      return { content: this.getMockResponse(message), isMock: true };
    }

    const messages = [
      ...history.map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })),
      { role: 'user', content: message }
    ];

    const payload = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      stream: false
    };

    const options = this._buildOptions('/v1/messages');

    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            console.log(`[Anthropic] 状态码: ${res.statusCode}`);
            if (res.statusCode !== 200) {
              console.error(`[Anthropic] 错误: ${data.substring(0, 300)}`);
              return resolve({ content: this.getMockResponse(message), isMock: true });
            }

            const json = JSON.parse(data);
            const content = json.content?.[0]?.text;
            if (content) {
              console.log(`[Anthropic] 成功, 长度: ${content.length}`);
              resolve({ content, isMock: false });
            } else {
              console.warn('[Anthropic] 响应格式异常:', JSON.stringify(json).substring(0, 300));
              resolve({ content: this.getMockResponse(message), isMock: true });
            }
          } catch (e) {
            console.error('[Anthropic] 解析错误:', e.message);
            resolve({ content: this.getMockResponse(message), isMock: true });
          }
        });
      });

      req.on('error', (err) => {
        console.error('[Anthropic] 请求错误:', err.message);
        resolve({ content: this.getMockResponse(message), isMock: true });
      });

      req.on('timeout', () => {
        console.error('[Anthropic] 请求超时');
        req.destroy();
        resolve({ content: this.getMockResponse(message), isMock: true });
      });

      req.write(JSON.stringify(payload));
      req.end();
    });
  }

  /**
   * 流式请求
   */
  async *getCompletionStream(message, history = []) {
    if (!this.authToken) {
      console.warn('[Anthropic] Auth token 缺失，使用模拟模式');
      const mockContent = this.getMockResponse(message);
      for (const char of mockContent) {
        yield { content: char, done: false };
      }
      yield { content: '', done: true };
      return;
    }

    const messages = [
      ...history.map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })),
      { role: 'user', content: message }
    ];

    const payload = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      stream: true
    };

    const options = this._buildOptions('/v1/messages');

    console.log(`[Anthropic 流式] Model: ${this.model}`);

    const streamPromise = new Promise((resolve, reject) => {
      const req = https.request(options, (res) => resolve(res));
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
      req.write(JSON.stringify(payload));
      req.end();
    });

    let res;
    try {
      res = await streamPromise;
    } catch (err) {
      yield { content: `[请求错误: ${err.message}]`, done: false };
      yield { content: '', done: true };
      return;
    }

    if (res.statusCode !== 200) {
      let errorData = '';
      for await (const chunk of res) { errorData += chunk; }
      console.error(`[Anthropic] 错误状态码: ${res.statusCode}, 响应: ${errorData.substring(0, 300)}`);
      yield { content: `[错误: ${res.statusCode}]`, done: false };
      yield { content: '', done: true };
      return;
    }

    let buffer = '';
    for await (const chunk of res) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          yield { content: '', done: true };
          return;
        }

        try {
          const json = JSON.parse(data);
          // Anthropic 流式: content_block_delta 事件
          if (json.type === 'content_block_delta' && json.delta?.text) {
            yield { content: json.delta.text, done: false };
          }
          // message_stop 表示结束
          if (json.type === 'message_stop') {
            yield { content: '', done: true };
            return;
          }
        } catch {}
      }
    }

    yield { content: '', done: true };
  }

  getMockResponse(message) {
    console.log('[模拟模式] 使用模拟响应');
    return `收到您的问题："${message}"。AI 服务暂时不可用，请稍后再试。`;
  }
}

module.exports = { AnthropicService };
