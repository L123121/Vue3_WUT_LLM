import axios from 'axios';
import crypto from 'crypto';
import config from '../config';

export class XunfeiService {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = config.xunfei.apiKey;
    this.apiSecret = config.xunfei.apiSecret;
    this.baseUrl = config.xunfei.baseUrl;
    
    if (!this.apiKey || !this.apiSecret) {
      console.warn('⚠️ 讯飞API配置缺失，将使用模拟模式');
    }
  }

  private generateSignature(date: string): string {
    const signatureOrigin = `host: ${new URL(this.baseUrl).host}\ndate: ${date}\nPOST /v1/chat/completions HTTP/1.1`;
    const signatureSha = crypto
      .createHmac('sha256', this.apiSecret)
      .update(signatureOrigin)
      .digest();
    return signatureSha.toString('base64');
  }

  private generateAuthorization(date: string): string {
    const signature = this.generateSignature(date);
    const authorizationOrigin = `api_key="${this.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
    return Buffer.from(authorizationOrigin).toString('base64');
  }

  async getCompletion(message: string, history: any[] = []): Promise<string> {
    // 如果没有配置API密钥，使用模拟响应
    if (!this.apiKey || !this.apiSecret) {
      return this.getMockResponse(message);
    }

    try {
      const date = new Date().toUTCString();
      const authorization = this.generateAuthorization(date);
      
      // 讯飞MaaS平台支持的模型列表
      // qwq-32b (Qwen2-72B), qwq-14b, qwq-7b, qwq-1.8b
      const model = "qwq-32b"; // 根据您的需求选择模型
      
      const messages = [
        { 
          role: "system", 
          content: "你是武理小精灵，武汉理工大学的学生助手。回答要友好、专业、简洁。"
        },
        ...history,
        { role: "user", content: message }
      ];

      const payload = {
        model,
        messages,
        stream: false,
        temperature: 0.7,
        max_tokens: 1024
      };

      console.log(`[讯飞API] 请求模型: ${model}, 消息长度: ${messages.length}`);

      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        payload,
        {
          headers: {
            'Authorization': authorization,
            'Content-Type': 'application/json',
            'Date': date,
            'Host': new URL(this.baseUrl).host
          },
          timeout: 30000
        }
      );

      // 处理响应
      if (response.data?.choices?.[0]?.message?.content) {
        return response.data.choices[0].message.content;
      } else if (response.data?.error?.message) {
        console.error('[讯飞API] 错误响应:', response.data.error);
        throw new Error(`API Error: ${response.data.error.message}`);
      } else {
        console.warn('[讯飞API] 非预期响应结构:', response.data);
        throw new Error('非预期的API响应格式');
      }

    } catch (error: any) {
      console.error('[讯飞API] 请求失败:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });

      // 提供友好的错误信息
      if (error.response?.status === 401) {
        throw new Error('API认证失败，请检查API Key和Secret配置');
      } else if (error.response?.status === 404) {
        throw new Error('API端点不存在，请检查baseUrl配置');
      } else if (error.code === 'ECONNREFUSED') {
        throw new Error('无法连接到讯飞服务器，请检查网络');
      } else if (error.response?.data?.error?.message) {
        throw new Error(`讯飞API错误: ${error.response.data.error.message}`);
      }
      
      throw error;
    }
  }

  // 模拟响应（用于开发和测试）
  private getMockResponse(message: string): string {
    console.log('[模拟模式] 使用模拟响应');
    
    const responses: Record<string, string> = {
      '你好': '你好！我是武理小精灵，基于讯飞Qwen模型的AI助手。有什么可以帮助你的吗？',
      '武汉理工': '武汉理工大学是教育部直属全国重点大学，是首批列入国家"211工程"和"双一流"建设高校。',
      '课程': '你可以查询计算机科学、人工智能、软件工程等专业的课程信息。需要了解哪个具体课程？',
      '图书馆': '图书馆开放时间：周一至周日 8:00-22:00。可以通过校园卡借阅图书，也可以使用数字资源。',
      '食堂': '学校有多个食堂：东院食堂、西院食堂、鉴湖食堂等。供应时间：早餐6:30-9:00，午餐11:00-13:00，晚餐17:00-19:00。',
      '宿舍': '学生宿舍配备空调、独立卫生间和网络接口。有4人间和6人间可供选择。',
      '专业': '热门专业包括：计算机科学与技术、人工智能、软件工程、数据科学、材料科学与工程等。'
    };

    const lowerMsg = message.toLowerCase();
    
    for (const [key, response] of Object.entries(responses)) {
      if (lowerMsg.includes(key.toLowerCase())) {
        return response;
      }
    }

    return `收到："${message}"。我是武理小精灵，正在使用Qwen模型。你可以问我关于武汉理工大学的任何问题！`;
  }
}