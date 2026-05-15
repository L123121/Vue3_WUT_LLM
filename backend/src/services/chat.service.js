const config = require('../config');
const { XunfeiService } = require('./xunfei.service');

class ChatService {
  constructor(xunfeiService = null) {
    this.xunfeiService = xunfeiService || new XunfeiService();
  }

  async getResponse(message, history = []) {
    try {
      const result = await this.xunfeiService.getCompletion(message, history);
      return {
        reply: result.content,
        timestamp: new Date(),
        model: config.anthropic?.model || 'anthropic',
        isMock: result.isMock
      };
    } catch (error) {
      console.error('ChatService 错误:', error);
      return {
        reply: '抱歉，AI服务处理出错，请稍后重试',
        timestamp: new Date(),
        model: config.anthropic?.model || 'anthropic',
        isMock: true,
        error: error.message
      };
    }
  }
}

module.exports = { ChatService };
