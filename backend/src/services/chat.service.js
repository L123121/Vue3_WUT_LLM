/**
 * ChatService — 精简对话服务
 *
 * 提供简单 LLM 聊天（非 RAG），用于问候、闲聊等无需检索知识库的场景。
 * 知识问答请使用 RagService。
 *
 * 历史：2026-07-21 移除 Agent 系统，ChatService 仅保留简单对话功能。
 */

const config = require('../config');
const { AiService } = require('./ai.service');

class ChatService {
  /**
   * @param {AiService|null} aiService - AI 服务实例，不传则内部创建
   */
  constructor(aiService = null) {
    this.aiService = aiService || new AiService();
  }

  async getResponse(message, history = []) {
    try {
      const result = await this.aiService.getCompletion(message, history);
      return {
        reply: result.content,
        timestamp: new Date(),
        model: config.ai.model || 'Qwen3.6-35B-A3B',
        isMock: result.isMock,
      };
    } catch (error) {
      console.error('ChatService 错误:', error);
      return {
        reply: '抱歉，AI服务处理出错，请稍后重试',
        timestamp: new Date(),
        model: config.ai.model || 'Qwen3.6-35B-A3B',
        isMock: true,
        error: error.message,
      };
    }
  }

  /**
   * 流式聊天
   * @param {string} message - 用户消息
   * @param {Array} history - 历史消息
   * @param {string} systemPrompt - 系统提示词
   * @yields {Object} { content: string, done: boolean }
   */
  async *getResponseStream(message, history = [], systemPrompt = '你是一个友好的校园助手，回答要简洁亲切。') {
    const chatHistory = [
      { role: 'system', content: systemPrompt },
      ...(history || []),
    ];

    for await (const chunk of this.aiService.getCompletionStream(message, chatHistory)) {
      yield chunk;
    }
  }
}

module.exports = { ChatService };