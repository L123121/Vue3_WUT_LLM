"use strict";

const https = require('https');
const { metrics } = require('../services/metrics.service');

// ==================== 共享 HTTPS 客户端 ====================
// 提供连接池（keep-alive）、重试、超时统一处理

const DEFAULT_TIMEOUT = 60000;
const DEFAULT_RETRIES = 2;
const RETRYABLE_STATUS = [408, 429, 502, 503, 504];

// 全局 keep-alive agent（连接池）
const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 20,
  maxFreeSockets: 5,
  timeout: 30000,
});

/**
 * 发送 HTTPS 请求（非流式），自动处理重试和错误
 * @param {Object} options - https.request options（不含 agent/timeout，可覆盖）
 * @param {number} [options.timeout=60000] - 请求超时 ms
 * @param {number} [options.retries=2] - 重试次数
 * @param {boolean} [options.retryOn5xx=true] - 5xx 是否重试
 * @param {string} [options.body] - JSON 字符串体
 * @returns {Promise<{statusCode, data, headers}>}
 */
async function request(options, body) {
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryOn5xx = options.retryOn5xx !== false;
  const url = new URL(`${options.protocol || 'https:'}//${options.hostname}${options.path}`);

  const reqOptions = {
    ...options,
    agent,
    timeout,
  };
  delete reqOptions.retries;
  delete reqOptions.retryOn5xx;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const start = Date.now();
    try {
      const result = await _sendRequest(reqOptions, body);
      metrics.recordLatency('http', Date.now() - start);
      return result;
    } catch (err) {
      lastError = err;
      const shouldRetry = attempt < retries && (
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ECONNREFUSED' ||
        (retryOn5xx && err.statusCode && RETRYABLE_STATUS.includes(err.statusCode))
      );
      if (!shouldRetry) break;
      const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 10000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

/**
 * 发送流式 HTTPS 请求（返回原始 IncomingMessage）
 * @param {Object} options - https.request options
 * @param {string} [body] - JSON 字符串体
 * @returns {Promise<IncomingMessage>}
 */
async function requestStream(options, body) {
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const reqOptions = {
    ...options,
    agent,
    timeout,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(reqOptions, (res) => {
      if (res.statusCode !== 200) {
        let errData = '';
        res.on('data', chunk => { errData += chunk; });
        res.on('end', () => {
          reject(new Error(`HTTP ${res.statusCode}: ${errData.slice(0, 200)}`));
        });
        return;
      }
      resolve(res);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    if (body) req.write(body);
    req.end();
  });
}

/**
 * 内部：发送单次请求
 */
function _sendRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`);
          err.statusCode = res.statusCode;
          return reject(err);
        }
        try {
          const json = JSON.parse(data);
          resolve({ statusCode: res.statusCode, data: json, headers: res.headers });
        } catch {
          resolve({ statusCode: res.statusCode, data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    if (body) req.write(body);
    req.end();
  });
}

module.exports = { request, requestStream };
