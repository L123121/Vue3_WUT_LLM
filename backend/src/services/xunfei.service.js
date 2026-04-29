const crypto = require('crypto');
const https = require('https');
const config = require('../config');

class XunfeiService {
  constructor() {
    // 解析 API Key 格式: "APIKey:APISecret"
    const apiKeyFull = config.xunfei.apiKey || '';
    if (apiKeyFull.includes(':')) {
      const [key, secret] = apiKeyFull.split(':');
      this.apiKey = key;
      this.apiSecret = secret;
    } else {
      this.apiKey = apiKeyFull;
      this.apiSecret = '';
    }

    this.baseUrl = config.xunfei.baseUrl || 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2';
    this.model = config.xunfei.model || 'astron-code-latest';
    this.temperature = config.xunfei.temperature || 0.7;
    this.maxTokens = config.xunfei.maxTokens || 4000;
    this.timeout = config.xunfei.timeout || 60000;
  }

  /**
   * 生成 HMAC 签名认证头（用于 maas-api）
   */
  _generateHmacAuthHeaders() {
    const date = new Date().toUTCString();
    const host = 'maas-api.cn-huabei-1.xf-yun.com';

    // 签名原始字符串 - 使用 \r\n 分隔
    const signatureOrigin = `host: ${host}\r\ndate: ${date}\r\nPOST /v2/chat/completions HTTP/1.1`;

    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(Buffer.from(signatureOrigin, 'utf8'))
      .digest('base64');

    const authorizationOrigin = `api_key="${this.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
    const authorization = Buffer.from(authorizationOrigin).toString('base64');

    return {
      'Content-Type': 'application/json',
      'Authorization': authorization,
      'Date': date,
      'Host': host,
      'User-Agent': 'Node.js-Client',
      'Accept': '*/*'
    };
  }

  /**
   * 非流式请求
   */
  async getCompletion(message, history = []) {
    if (!this.apiKey || !this.apiSecret) {
      console.warn('[讯飞] API Key 或 Secret 缺失，使用模拟模式');
      return { content: this.getMockResponse(message), isMock: true };
    }

    const messages = [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
    ];

    const payload = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      stream: false
    };

    // 判断使用哪种认证方式
    const isMaasCodingApi = this.baseUrl.includes('maas-coding-api');

    return new Promise((resolve) => {
      let options;
      const host = isMaasCodingApi ? 'maas-coding-api.cn-huabei-1.xf-yun.com' : 'maas-api.cn-huabei-1.xf-yun.com';

      if (isMaasCodingApi) {
        // maas-coding-api 使用 Bearer token
        options = {
          hostname: host,
          port: 443,
          path: '/v2/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}:${this.apiSecret}`
          },
          timeout: this.timeout
        };
        console.log(`[讯飞HTTP] 使用 Bearer Token 认证`);
      } else {
        // maas-api 使用 HMAC 签名
        options = {
          hostname: host,
          port: 443,
          path: '/v2/chat/completions',
          method: 'POST',
          headers: this._generateHmacAuthHeaders(),
          timeout: this.timeout
        };
        console.log(`[讯飞HTTP] 使用 HMAC 签名认证`);
      }

      console.log(`[讯飞HTTP] 请求: ${host}/v2/chat/completions, Model: ${this.model}`);

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            console.log(`[讯飞HTTP] 状态码: ${res.statusCode}`);

            if (res.statusCode !== 200) {
              console.error(`[讯飞HTTP] 错误响应: ${data}`);
              try {
                const errorJson = JSON.parse(data);
                const errorMsg = errorJson.error?.message || errorJson.message || '未知错误';
                return resolve({ content: `AI服务错误: ${errorMsg}`, isMock: true });
              } catch {}
              return resolve({ content: this.getMockResponse(message), isMock: true });
            }

            const json = JSON.parse(data);
            const content = json.choices?.[0]?.message?.content;

            if (content) {
              console.log(`[讯飞HTTP] 成功, 响应长度: ${content.length}`);
              resolve({ content, isMock: false });
            } else {
              console.warn('[讯飞HTTP] 响应格式异常:', json);
              resolve({ content: this.getMockResponse(message), isMock: true });
            }
          } catch (e) {
            console.error('[讯飞HTTP] 解析错误:', e.message);
            resolve({ content: this.getMockResponse(message), isMock: true });
          }
        });
      });

      req.on('error', (err) => {
        console.error('[讯飞HTTP] 请求错误:', err.message);
        resolve({ content: this.getMockResponse(message), isMock: true });
      });

      req.on('timeout', () => {
        console.error('[讯飞HTTP] 请求超时');
        req.destroy();
        resolve({ content: this.getMockResponse(message), isMock: true });
      });

      req.write(JSON.stringify(payload));
      req.end();
    });
  }

  /**
   * 流式请求 - 返回 async generator
   */
  async *getCompletionStream(message, history = []) {
    if (!this.apiKey || !this.apiSecret) {
      console.warn('[讯飞流式] API Key 或 Secret 缺失，使用模拟模式');
      const mockContent = this.getMockResponse(message);
      for (const char of mockContent) {
        yield { content: char, done: false };
      }
      yield { content: '', done: true };
      return;
    }

    const messages = [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
    ];

    const payload = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      stream: true
    };

    const isMaasCodingApi = this.baseUrl.includes('maas-coding-api');
    const host = isMaasCodingApi ? 'maas-coding-api.cn-huabei-1.xf-yun.com' : 'maas-api.cn-huabei-1.xf-yun.com';

    let options;
    if (isMaasCodingApi) {
      options = {
        hostname: host,
        port: 443,
        path: '/v2/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}:${this.apiSecret}`
        },
        timeout: this.timeout
      };
    } else {
      options = {
        hostname: host,
        port: 443,
        path: '/v2/chat/completions',
        method: 'POST',
        headers: this._generateHmacAuthHeaders(),
        timeout: this.timeout
      };
    }

    console.log(`[讯飞流式] Model: ${this.model}`);

    // 使用 Promise 包装请求，然后 yield 结果
    const streamPromise = new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        resolve(res);
      });

      req.on('error', (err) => {
        console.error('[讯飞流式] 请求错误:', err.message);
        reject(err);
      });

      req.on('timeout', () => {
        console.error('[讯飞流式] 请求超时');
        req.destroy();
        reject(new Error('请求超时'));
      });

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

    let buffer = '';

    if (res.statusCode !== 200) {
      let errorData = '';
      for await (const chunk of res) {
        errorData += chunk;
      }
      console.error(`[讯飞流式] 错误状态码: ${res.statusCode}, 响应: ${errorData}`);
      yield { content: `[流式错误: ${res.statusCode}]`, done: false };
      yield { content: '', done: true };
      return;
    }

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
          const content = json.choices?.[0]?.delta?.content || '';
          if (content) {
            yield { content, done: false };
          }
        } catch {
          // 跳过解析错误
        }
      }
    }

    // 处理剩余缓冲区
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data:')) {
        const data = trimmed.slice(5).trim();
        if (data !== '[DONE]') {
          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content || '';
            if (content) {
              yield { content, done: false };
            }
          } catch {}
        }
      }
    }

    yield { content: '', done: true };
  }

  getMockResponse(message) {
    console.log('[模拟模式] 使用模拟响应');
    const responses = [
      `收到您的问题："${message}"。我目前处于模拟模式，无法提供真实回复。请检查 API 配置。`,
      `您好！我暂时无法连接到 AI 服务。请确认讯飞 API 配置是否正确。`,
      `抱歉，AI 服务暂时不可用。请稍后再试。`
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
}

module.exports = { XunfeiService };