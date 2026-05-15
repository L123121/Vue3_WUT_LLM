"use strict";

const crypto = require('crypto');
const https = require('https');
const WebSocket = require('ws');

class ChatdocService {
  constructor() {
    this.appId = process.env.XUNFEI_APP_ID || '';
    this.appSecret = process.env.XUNFEI_API_SECRET || '';

    // 从 API_KEY 格式中提取 secret
    const apiKeyConfig = process.env.XUNFEI_API_KEY || '';
    if (apiKeyConfig.includes(':')) {
      const parts = apiKeyConfig.split(':');
      this.apiKey = parts[0];
      if (!this.appSecret) this.appSecret = parts[1];
    } else {
      this.apiKey = apiKeyConfig;
    }

    this.uploadUrl = 'https://chatdoc.xfyun.cn/openapi/v1/file/upload';
    this.statusUrl = 'https://chatdoc.xfyun.cn/openapi/v1/file/status';
    this.chatHost = 'chatdoc.xfyun.cn';
    this.chatPath = '/openapi/chat';
  }

  /**
   * 生成签名：MD5(appId + timestamp) -> HMAC-SHA1(auth, secret)
   */
  _generateSignature(timestamp) {
    const md5Input = `${this.appId}${timestamp}`;
    const auth = crypto.createHash('md5').update(md5Input).digest('hex');
    const signature = crypto
      .createHmac('sha1', this.appSecret)
      .update(auth)
      .digest('base64');
    return signature;
  }

  /**
   * 生成鉴权头
   */
  _getAuthHeaders() {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = this._generateSignature(timestamp);
    return {
      appId: this.appId,
      timestamp: String(timestamp),
      signature
    };
  }

  /**
   * HTTP POST 请求
   */
  _httpPost(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        timeout: 60000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) {
            reject(new Error(`解析响应失败: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  /**
   * 上传文档到星火知识库
   * @param {Buffer} fileBuffer - 文件内容
   * @param {string} fileName - 文件名
   * @returns {Promise<Object>} 上传结果
   */
  async uploadDocument(fileBuffer, fileName) {
    const authHeaders = this._getAuthHeaders();

    // 使用 multipart/form-data 上传
    const boundary = `----FormBoundary${Date.now()}`;
    const ext = fileName.split('.').pop().toLowerCase();
    const fileType = ext === 'pdf' ? 'pdf' : ext === 'docx' || ext === 'doc' ? 'doc' : 'txt';

    let body = '';
    // appId
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="appId"\r\n\r\n`;
    body += `${this.appId}\r\n`;
    // fileType
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="fileType"\r\n\r\n`;
    body += `wiki\r\n`;
    // parseType
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="parseType"\r\n\r\n`;
    body += `AUTO\r\n`;
    // fileName
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="fileName"\r\n\r\n`;
    body += `${fileName}\r\n`;
    // file
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`;
    body += `Content-Type: application/octet-stream\r\n\r\n`;

    const bodyStart = Buffer.from(body, 'utf-8');
    const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    const fullBody = Buffer.concat([bodyStart, fileBuffer, bodyEnd]);

    return new Promise((resolve, reject) => {
      const urlObj = new URL(this.uploadUrl);
      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': fullBody.length,
          'appId': authHeaders.appId,
          'timestamp': authHeaders.timestamp,
          'signature': authHeaders.signature
        },
        timeout: 60000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) {
            reject(new Error(`解析响应失败: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });

      req.write(fullBody);
      req.end();
    });
  }

  /**
   * 查询文档状态
   */
  async getFileStatus(fileIds) {
    const authHeaders = this._getAuthHeaders();
    const fileIdsStr = Array.isArray(fileIds) ? fileIds.join(',') : fileIds;

    // 使用 form-data 格式
    const body = `fileIds=${encodeURIComponent(fileIdsStr)}`;

    return new Promise((resolve, reject) => {
      const urlObj = new URL(this.statusUrl);
      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'appId': authHeaders.appId,
          'timestamp': authHeaders.timestamp,
          'signature': authHeaders.signature
        },
        timeout: 15000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`解析响应失败: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });

      req.write(body);
      req.end();
    });
  }

  /**
   * 等待文档向量化完成
   */
  async waitForVectoring(fileId, maxWait = 60000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      try {
        const status = await this.getFileStatus(fileId);
        if (status.code === 0 && status.data) {
          const fileStatus = Array.isArray(status.data) ? status.data[0] : status.data;
          if (fileStatus?.fileStatus === 'vectored') {
            return true;
          }
          if (fileStatus?.fileStatus === 'failed') {
            throw new Error('文档向量化失败');
          }
        } else {
          // 状态查询失败，不阻塞上传流程
          console.warn(`[ChatDoc] 状态查询返回: ${status.desc || status.code}`);
          break;
        }
      } catch (err) {
        console.warn(`[ChatDoc] 状态查询异常: ${err.message}`);
        break;
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    // 超时不阻塞，继续流程
    return false;
  }

  /**
   * 通过 WebSocket 进行文档问答
   */
  async chat(fileIds, messages, options = {}) {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = this._generateSignature(timestamp);

    const chatUrl = `wss://${this.chatHost}${this.chatPath}?appId=${this.appId}&timestamp=${timestamp}&signature=${encodeURIComponent(signature)}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(chatUrl);
      let timeout = null;
      let fullContent = '';
      let fileRefer = null;

      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error('问答超时'));
      }, 60000);

      ws.on('open', () => {
        const payload = {
          fileIds,
          messages,
          chatExtends: {
            temperature: options.temperature || 0.5,
            spark: true
          }
        };

        console.log(`[ChatDoc] 发送问答, fileIds: ${fileIds.length}个, messages: ${messages.length}条`);
        ws.send(JSON.stringify(payload));
      });

      ws.on('message', (data) => {
        try {
          const result = JSON.parse(data.toString());

          if (result.code !== 0) {
            cleanup();
            return reject(new Error(`ChatDoc Error ${result.code}: ${result.message}`));
          }

          // status: 0=首次, 1=中间, 2=最后, 99=引用
          if (result.status === 2 || result.status === 0) {
            if (result.content) fullContent += result.content;
          } else if (result.status === 1) {
            if (result.content) fullContent += result.content;
          } else if (result.status === 99) {
            // 引用信息
            if (result.fileRefer) {
              try {
                fileRefer = JSON.parse(result.fileRefer);
              } catch {}
            }
          }

          // 最后一个结果
          if (result.status === 2) {
            cleanup();
            resolve({ content: fullContent, fileRefer });
          }
        } catch (e) {
          // 跳过解析错误
        }
      });

      ws.on('error', (err) => {
        cleanup();
        reject(new Error(`WebSocket 错误: ${err.message}`));
      });

      ws.on('close', () => {
        if (fullContent) {
          resolve({ content: fullContent, fileRefer });
        }
      });
    });
  }

  /**
   * 流式 WebSocket 问答
   */
  async *chatStream(fileIds, messages, options = {}) {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = this._generateSignature(timestamp);

    const chatUrl = `wss://${this.chatHost}${this.chatPath}?appId=${this.appId}&timestamp=${timestamp}&signature=${encodeURIComponent(signature)}`;

    const ws = new WebSocket(chatUrl);
    let timeout = null;
    let settled = false;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
      }
    }, 60000);

    try {
      // 等待连接建立
      await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', (err) => { reject(err); });
      });

      // 发送问题
      const payload = {
        fileIds,
        messages,
        chatExtends: {
          temperature: options.temperature || 0.5,
          spark: true
        }
      };
      console.log(`[ChatDoc Stream] 发送问答, fileIds: ${fileIds.length}个`);
      ws.send(JSON.stringify(payload));

      // 接收流式响应
      while (true) {
        const data = await new Promise((resolve) => {
          const onMessage = (raw) => { ws.removeListener('close', onClose); resolve(raw.toString()); };
          const onClose = () => { ws.removeListener('message', onMessage); resolve(null); };
          ws.once('message', onMessage);
          ws.once('close', onClose);
        });

        if (data === null) break;

        try {
          const result = JSON.parse(data);
          if (result.code !== 0) {
            yield { type: 'error', content: result.message };
            break;
          }

          if (result.status === 99 && result.fileRefer) {
            let fileRefer;
            try { fileRefer = JSON.parse(result.fileRefer); } catch {}
            yield { type: 'sources', fileRefer };
          } else if (result.content) {
            yield { type: 'content', content: result.content };
          }

          if (result.status === 2) break;
        } catch {}
      }
    } finally {
      cleanup();
    }
  }
}

module.exports = { ChatdocService };
