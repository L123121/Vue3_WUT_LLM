import WebSocket from 'ws';
import axios from 'axios';
import crypto from 'crypto';
import config from '../config';

export interface CompletionResponse {
  content: string;
  isMock: boolean;
}

export interface StreamChunk {
  content: string;
  done: boolean;
}

export class XunfeiService {
  private appId: string;
  private apiKey: string;
  private apiSecret: string;
  private wsUrl: string;
  private httpUrl: string;
  private serviceName: string;
  private model: string;
  private domain: string;
  private patchId: string;

  constructor() {
    this.appId = config.xunfei.appId;
    this.apiKey = config.xunfei.apiKeyWs;
    this.apiSecret = config.xunfei.apiSecretWs;
    this.wsUrl = config.xunfei.wsUrl;
    this.domain = config.xunfei.domain;
    this.patchId = config.xunfei.patchId;
    
    // HTTP config
    this.httpUrl = config.xunfei.baseUrl;
    this.model = config.xunfei.model || 'GLM-4.7-Flash';
    this.serviceName = config.xunfei.serviceName || 'Chatwut';

    // Fallback for missing WS keys
    if (!this.apiKey && config.xunfei.apiKey && config.xunfei.apiKey.includes(':')) {
      const parts = config.xunfei.apiKey.split(':');
      this.apiKey = parts[0];
      this.apiSecret = parts[1];
    }
    
    if (!this.appId || !this.apiKey || !this.apiSecret) {
      console.warn('⚠️ 讯飞WebSocket凭证缺失，将尝试使用 HTTP 或 模拟模式');
    }
  }

  async getCompletion(message: string, history: any[] = []): Promise<CompletionResponse> {
    // 1. Try HTTP First (as requested by user preference order in prompt)
    try {
      if (this.httpUrl && config.xunfei.apiKey) {
        console.log(`[讯飞HTTP] 尝试连接: ${this.httpUrl}, Model: ${this.model}`);
        const result = await this.chatHttp(message, history);
        return { content: result, isMock: false };
      }
    } catch (httpError: any) {
      console.warn(`[讯飞HTTP] 失败: ${httpError.message}. 尝试 WebSocket...`);
    }

    // 2. Try WebSocket
    try {
      if (this.appId && this.apiKey && this.apiSecret) {
        console.log(`[讯飞WS] 尝试连接: ${this.wsUrl}, Domain: ${this.serviceName}`);
        const result = await this.chatWs(message, history);
        return { content: result, isMock: false };
      }
    } catch (wsError: any) {
      console.error('[讯飞WS] 失败:', wsError.message);
    }

    // 3. Fallback to Mock
    return { content: this.getMockResponse(message), isMock: true };
  }

  private async chatHttp(message: string, history: any[]): Promise<string> {
    const messages = [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: "user", content: message }
    ];

    // Ensure baseUrl doesn't end with slash if we append path
    // But user provided path might be the full path or base.
    // If it ends in /v2, we usually append /chat/completions
    let url = this.httpUrl;
    if (url.endsWith('/v2')) {
      url = `${url}/chat/completions`;
    }

    const payload = {
      model: this.model, // Try model name first
      messages,
      stream: false,
      temperature: config.xunfei.temperature || 0.7,
      max_tokens: config.xunfei.maxTokens || 1024
    };

    try {
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.xunfei.apiKey}`
        },
        timeout: config.xunfei.timeout || 30000
      });

      if (response.data?.choices?.[0]?.message?.content) {
        return response.data.choices[0].message.content;
      }
      throw new Error('Invalid response structure');
    } catch (error: any) {
      // If 404/500, maybe try using ServiceName as model?
      if (error.response?.status === 404 || (error.response?.data?.error?.code === '10404')) {
         console.log('[讯飞HTTP] 重试: 使用 ServiceName 作为 model');
         const retryPayload = { ...payload, model: this.serviceName };
         const response = await axios.post(url, retryPayload, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.xunfei.apiKey}`
            },
            timeout: config.xunfei.timeout || 30000
         });
         if (response.data?.choices?.[0]?.message?.content) {
            return response.data.choices[0].message.content;
         }
      }
      throw error;
    }
  }

  private getWsAuthUrl(): string {
    const urlObj = new URL(this.wsUrl);
    const host = urlObj.host;
    const path = urlObj.pathname;
    const date = new Date().toUTCString();
    const algorithm = 'hmac-sha256';
    const headers = 'host date request-line';
    const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
    
    const signature = crypto.createHmac('sha256', this.apiSecret)
      .update(signatureOrigin)
      .digest('base64');
      
    const authorizationOrigin = `api_key="${this.apiKey}", algorithm="${algorithm}", headers="${headers}", signature="${signature}"`;
    const authorization = Buffer.from(authorizationOrigin).toString('base64');
    
    return `${this.wsUrl}?authorization=${authorization}&date=${encodeURI(date)}&host=${host}`;
  }

  private chatWs(message: string, history: any[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = this.getWsAuthUrl();
      const ws = new WebSocket(url);
      let fullResponse = '';
      let isError = false;

      ws.on('open', () => {
        const textMessages = history.map(h => ({ 
          role: h.role === 'model' ? 'assistant' : h.role, 
          content: h.content 
        }));
        textMessages.push({ role: 'user', content: message });

        const params = {
          header: {
            app_id: this.appId,
            uid: "user_" + Date.now().toString().slice(-6),
            patch_id: this.patchId ? [this.patchId] : []
          },
          parameter: {
            chat: {
              domain: this.domain || 'general',
              temperature: config.xunfei.temperature || 0.7,
              max_tokens: config.xunfei.maxTokens || 1024
            }
          },
          payload: {
            message: {
              text: textMessages
            }
          }
        };

        ws.send(JSON.stringify(params));
      });

      ws.on('message', (data) => {
        try {
          const str = data.toString();
          const json = JSON.parse(str);

          if (json.header.code !== 0) {
            isError = true;
            ws.close();
            reject(new Error(`讯飞API错误: ${json.header.message} (Code: ${json.header.code})`));
            return;
          }

          if (json.payload?.choices?.text) {
            fullResponse += json.payload.choices.text[0].content;
          }

          if (json.header.status === 2) {
            ws.close();
            resolve(fullResponse);
          }
        } catch (e) {
          isError = true;
          ws.close();
          reject(e);
        }
      });

      ws.on('error', (err) => {
        isError = true;
        reject(err);
      });
    });
  }

  private getMockResponse(message: string): string {
    console.log('[模拟模式] 使用模拟响应');
    return `[Mock] 收到: "${message}"。 (由于连接问题，暂时使用模拟回复)\n当前配置: Model=${this.model}, Service=${this.serviceName}`;
  }

  /**
   * 流式 HTTP 请求，返回 async generator
   */
  async *getCompletionStream(message: string, history: any[] = []): AsyncGenerator<StreamChunk> {
    const messages = [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: "user", content: message }
    ];

    let url = this.httpUrl;
    if (url.endsWith('/v2')) {
      url = `${url}/chat/completions`;
    }

    console.log(`[讯飞流式] URL: ${url}, Model: ${this.model}`);

    const payload = {
      model: this.model,
      messages,
      stream: true,
      temperature: config.xunfei.temperature || 0.7,
      max_tokens: config.xunfei.maxTokens || 1024
    };

    try {
      console.log('[讯飞流式] 发起请求...');
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.xunfei.apiKey}`
        },
        timeout: config.xunfei.timeout || 60000,
        responseType: 'stream'
      });

      let buffer = '';
      const stream = response.data;

      for await (const chunk of stream) {
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
            // skip malformed JSON
          }
        }
      }

      // Handle remaining buffer
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
            } catch {
              // skip
            }
          }
        }
      }

      yield { content: '', done: true };
    } catch (error: any) {
      console.error('[讯飞流式HTTP] 失败:', error.message);
      console.error('[讯飞流式HTTP] 详细:', error.response?.data || error.code);
      // Fallback to mock for stream
      console.log('[讯飞流式] 使用模拟模式...');
      const mockContent = this.getMockResponse(message);
      for (const char of mockContent) {
        yield { content: char, done: false };
      }
      yield { content: '', done: true };
    }
  }
}
