const config = require('../config');
const { XunfeiService } = require('./xunfei.service');

class ChatService {
  constructor() {
    this.xunfeiService = new XunfeiService();
  }

  async getResponse(message, history = []) {
    try {
      const result = await this.xunfeiService.getCompletion(message, history);
      return {
        reply: result.content,
        timestamp: new Date(),
        model: config.xunfei.model || 'astron-code-latest',
        isMock: result.isMock
      };
    } catch (error) {
      console.error('ChatService 错误:', error);
      return {
        reply: `抱歉，AI服务处理出错: ${error.message}`,
        timestamp: new Date(),
        model: config.xunfei.model || 'astron-code-latest',
        isMock: true,
        error: error.message
      };
    }
  }
}

module.exports = { ChatService };
