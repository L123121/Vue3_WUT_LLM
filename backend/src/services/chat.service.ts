import config from '../config';
import { XunfeiService } from './xunfei.service';

export class ChatService {
  private xunfeiService: XunfeiService;

  constructor() {
    this.xunfeiService = new XunfeiService();
  }

  async getResponse(message: string, history: any[] = []) {
    try {
      const result = await this.xunfeiService.getCompletion(message, history);
      
      return {
        reply: result.content,
        timestamp: new Date(),
        model: config.xunfei.model || 'Qwen',
        isMock: result.isMock
      };
    } catch (error: any) {
      console.error('ChatService 错误:', error);
      return {
        reply: `抱歉，AI服务处理出错: ${error.message}`,
        timestamp: new Date(),
        model: config.xunfei.model || 'Qwen',
        isMock: true,
        error: error.message
      };
    }
  }
}
