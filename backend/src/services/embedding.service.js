"use strict";

const axios = require('axios');
const crypto = require('crypto');

class EmbeddingService {
  constructor() {
    // 从环境变量获取配置
    // 格式：apiKey:apiSecret
    const apiKeyConfig = process.env.XUNFEI_API_KEY || '';

    if (apiKeyConfig.includes(':')) {
      const parts = apiKeyConfig.split(':');
      this.apiKey = parts[0];
      this.apiSecret = parts[1];
    } else {
      this.apiKey = apiKeyConfig;
      this.apiSecret = process.env.XUNFEI_API_SECRET || '';
    }

    // 讯飞 Embedding API 配置
    // 方案一：使用 MaaS 平台（与聊天 API 相同的认证方式）
    this.maasHost = process.env.XUNFEI_EMBEDDING_HOST || 'maas-api.cn-huabei-1.xf-yun.com';
    this.maasPath = '/v2/embeddings';
    this.maasModel = process.env.XUNFEI_EMBEDDING_MODEL || 'emb-text-001';

    // 方案二：使用独立的 Embedding 服务
    this.standaloneHost = 'emb-cn-huabei-1.xf-yun.com';
    this.standalonePath = '/v2/embeddings';

    // 优先使用 MaaS 平台
    this.useMaas = true;
  }

  /**
   * 生成 MaaS 平台签名
   */
  generateMaasSignature(date) {
    const signatureOrigin = `host: ${this.maasHost}\ndate: ${date}\nPOST ${this.maasPath} HTTP/1.1`;
    const signatureSha = crypto
      .createHmac('sha256', this.apiSecret)
      .update(Buffer.from(signatureOrigin, 'utf8'))
      .digest('base64');

    const authorizationOrigin = `api_key="${this.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureSha}"`;
    return Buffer.from(authorizationOrigin).toString('base64');
  }

  /**
   * 生成独立服务签名
   */
  generateStandaloneSignature(date) {
    const signatureOrigin = `host: ${this.standaloneHost}\ndate: ${date}\nPOST ${this.standalonePath} HTTP/1.1`;
    const signatureSha = crypto
      .createHmac('sha256', this.apiSecret)
      .update(Buffer.from(signatureOrigin, 'utf8'))
      .digest('base64');

    const authorizationOrigin = `api_key="${this.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureSha}"`;
    return Buffer.from(authorizationOrigin).toString('base64');
  }

  /**
   * 获取文本的向量表示
   * @param {string|string[]} texts - 单个文本或文本数组
   * @returns {Promise<number[][]>} 向量数组
   */
  async getEmbeddings(texts) {
    const inputArray = Array.isArray(texts) ? texts : [texts];

    // 过滤空文本
    const validTexts = inputArray.filter(t => t && t.trim());
    if (validTexts.length === 0) {
      return [];
    }

    // 限制单次请求的文本数量
    if (validTexts.length > 10) {
      console.warn('[Embedding] 单次请求文本数量超过10，将分批处理');
      return this.getEmbeddingsBatch(validTexts);
    }

    // 尝试 MaaS 平台
    try {
      const result = await this.callMaasApi(validTexts);
      console.log(`[Embedding] MaaS API 成功，返回 ${result.length} 个向量`);
      return result;
    } catch (maasError) {
      console.warn('[Embedding] MaaS API 失败:', maasError.message);

      // 尝试独立服务
      try {
        const result = await this.callStandaloneApi(validTexts);
        console.log(`[Embedding] 独立 API 成功，返回 ${result.length} 个向量`);
        return result;
      } catch (standaloneError) {
        console.error('[Embedding] 独立 API 也失败:', standaloneError.message);
        throw new Error(`Embedding API 调用失败: ${maasError.message}`);
      }
    }
  }

  /**
   * 调用 MaaS 平台 API
   */
  async callMaasApi(texts) {
    const date = new Date().toUTCString();
    const authorization = this.generateMaasSignature(date);

    const response = await axios.post(
      `https://${this.maasHost}${this.maasPath}`,
      {
        model: this.maasModel,
        input: texts
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authorization,
          'Date': date,
          'Host': this.maasHost
        },
        timeout: 30000
      }
    );

    if (response.data?.data) {
      return response.data.data.map(item => item.embedding);
    }

    throw new Error(response.data?.error?.message || 'Invalid MaaS response');
  }

  /**
   * 调用独立 Embedding API
   */
  async callStandaloneApi(texts) {
    const date = new Date().toUTCString();
    const authorization = this.generateStandaloneSignature(date);

    const response = await axios.post(
      `https://${this.standaloneHost}${this.standalonePath}`,
      {
        model: 'emb-text-001',
        input: texts
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authorization,
          'Date': date,
          'Host': this.standaloneHost
        },
        timeout: 30000
      }
    );

    if (response.data?.data) {
      return response.data.data.map(item => item.embedding);
    }

    throw new Error(response.data?.error?.message || 'Invalid standalone response');
  }

  /**
   * 获取单个文本的向量
   * @param {string} text - 文本内容
   * @returns {Promise<number[]>} 向量
   */
  async getSingleEmbedding(text) {
    const embeddings = await this.getEmbeddings([text]);
    return embeddings[0] || null;
  }

  /**
   * 批量获取向量（分批处理，避免超时）
   * @param {string[]} texts - 文本数组
   * @param {number} batchSize - 每批数量（默认 5）
   * @returns {Promise<number[][]>} 向量数组
   */
  async getEmbeddingsBatch(texts, batchSize = 5) {
    const results = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await this.getEmbeddings(batch);
      results.push(...embeddings);

      // 添加延迟避免限流
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

