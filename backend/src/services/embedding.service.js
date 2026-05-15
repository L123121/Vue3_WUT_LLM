"use strict";

const crypto = require('crypto');
const WebSocket = require('ws');

class EmbeddingService {
  constructor() {
    const apiKeyConfig = process.env.XUNFEI_API_KEY || '';
    if (apiKeyConfig.includes(':')) {
      const parts = apiKeyConfig.split(':');
      this.apiKey = parts[0];
      this.apiSecret = parts[1];
    } else {
      this.apiKey = apiKeyConfig;
      this.apiSecret = process.env.XUNFEI_API_SECRET || '';
    }
    this.appId = process.env.XUNFEI_APP_ID || '';

    this.host = 'emb-cn-huabei-1.xf-yun.com';
    this.path = '/v2/embeddings';
  }

  /**
   * 讯飞签名认证：MD5(appId + timestamp) -> HMAC-SHA1(auth, secret)
   */
  _generateSignature(timestamp) {
    // 1. MD5(appId + timestamp)
    const md5Input = `${this.appId}${timestamp}`;
    const auth = crypto.createHash('md5').update(md5Input).digest('hex');

    // 2. HMAC-SHA1(auth, secret)
    const signature = crypto
      .createHmac('sha1', this.apiSecret)
      .update(auth)
      .digest('base64');

    return signature;
  }

  /**
   * 构建带鉴权的 WebSocket URL
   */
  _buildAuthUrl() {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = this._generateSignature(timestamp);

    const authUrl = `wss://${this.host}${this.path}?appId=${this.appId}&timestamp=${timestamp}&signature=${encodeURIComponent(signature)}`;
    return authUrl;
  }

  /**
   * 通过 WebSocket 调用讯飞 Embedding API
   */
  _callWebSocket(texts, domain = 'para') {
    return new Promise((resolve, reject) => {
      const authUrl = this._buildAuthUrl();
      console.log(`[Embedding] 连接: ${this.host}${this.path}`);

      const ws = new WebSocket(authUrl);
      let timeout = null;

      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error('WebSocket 请求超时'));
      }, 30000);

      ws.on('open', () => {
        const payload = {
          header: {
            app_id: this.appId,
            status: 3
          },
          parameter: {
            emb: {
              domain,
              feature: {
                encoding: 'utf8',
                compress: 'raw',
                format: 'plain'
              }
            }
          },
          payload: {
            messages: {
              encoding: 'utf8',
              compress: 'raw',
              format: 'json',
              status: 3,
              text: JSON.stringify(texts.map(t => ({ content: t })))
            }
          }
        };

        console.log(`[Embedding] 发送请求，文本数: ${texts.length}, domain: ${domain}`);
        ws.send(JSON.stringify(payload));
      });

      ws.on('message', (data) => {
        cleanup();
        try {
          const result = JSON.parse(data.toString());
          console.log(`[Embedding] 收到响应, header.code: ${result.header?.code}`);

          if (result.header?.code !== 0) {
            return reject(new Error(`API Error ${result.header?.code}: ${result.header?.message}`));
          }

          const responses = result.payload?.responses || [];
          const embeddings = responses.map(item => {
            return item.feature?.data || [];
          });

          resolve(embeddings);
        } catch (e) {
          reject(new Error(`解析响应失败: ${e.message}`));
        }
      });

      ws.on('error', (err) => {
        cleanup();
        reject(new Error(`WebSocket 错误: ${err.message}`));
      });

      ws.on('close', (code, reason) => {
        if (timeout) {
          cleanup();
          reject(new Error(`WebSocket 连接关闭: ${code} ${reason}`));
        }
      });
    });
  }

  /**
   * 获取文本的向量表示
   */
  async getEmbeddings(texts) {
    const inputArray = Array.isArray(texts) ? texts : [texts];
    const validTexts = inputArray.filter(t => t && t.trim());
    if (validTexts.length === 0) return [];

    if (validTexts.length > 10) {
      console.warn('[Embedding] 单次请求文本数量超过10，将分批处理');
      return this.getEmbeddingsBatch(validTexts);
    }

    const embeddings = await this._callWebSocket(validTexts, 'para');
    console.log(`[Embedding] 成功，返回 ${embeddings.length} 个向量`);
    return embeddings;
  }

  /**
   * 获取单个文本的向量
   */
  async getSingleEmbedding(text) {
    const embeddings = await this.getEmbeddings([text]);
    return embeddings[0] || null;
  }

  /**
   * 批量获取向量（分批处理）
   */
  async getEmbeddingsBatch(texts, batchSize = 5) {
    const results = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await this.getEmbeddings(batch);
      results.push(...embeddings);
      if (i + batchSize < texts.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    return results;
  }

  /**
   * 测试 Embedding 服务连接
   */
  async testConnection() {
    try {
      const result = await this.getSingleEmbedding('测试连接');
      return {
        success: true,
        vectorDimension: result?.length || 0,
        message: 'Embedding 服务连接正常'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Embedding 服务连接失败'
      };
    }
  }
}

module.exports = { EmbeddingService };
