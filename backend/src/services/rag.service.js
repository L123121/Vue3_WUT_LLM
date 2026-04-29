"use strict";

const { EmbeddingService } = require('./embedding.service');
const { chromaService } = require('./chroma.service');
const { XunfeiService } = require('./xunfei.service');
const config = require('../config');

class RagService {
  constructor() {
    this.embeddingService = new EmbeddingService();
    this.xunfeiService = new XunfeiService();
    this.topK = 5; // 检索相关文档数量
    this.maxContextLength = 2000; // 最大上下文长度
  }

  /**
   * 检索相关文档
   * @param {string} query - 用户查询
   * @param {Object} options - 选项 {topK, category}
   * @returns {Promise<Object[]>} 相关文档列表
   */
  async retrieve(query, options = {}) {
    const { topK = this.topK, category } = options;

    // 检查 Chroma 是否连接
    if (!chromaService.isConnected) {
      console.warn('[RAG] Chroma 未连接，跳过检索');
      return [];
    }

    // 1. 查询向量化
    const queryEmbedding = await this.embeddingService.getSingleEmbedding(query);
    if (!queryEmbedding) {
      console.warn('[RAG] 查询向量化失败');
      return [];
    }

    // 2. 构建过滤条件
    const where = category ? { category } : null;

    // 3. 相似度搜索
    const results = await chromaService.search(queryEmbedding, topK, where);

    console.log(`[RAG] 检索到 ${results.length} 条相关文档`);
    return results;
  }

  /**
   * 构建增强上下文
   * @param {Object[]} documents - 检索到的文档
   * @returns {string} 上下文字符串
   */
  buildContext(documents) {
    if (!documents || documents.length === 0) {
      return '';
    }

    let context = '';
    let totalLength = 0;

    for (const doc of documents) {
      const content = doc.content || '';
      const entry = `【相关资料】\n${content}\n`;

      if (totalLength + entry.length > this.maxContextLength) {
        break;
      }

      context += entry + '---\n';
      totalLength += entry.length;
    }

    return context;
  }

  /**
   * 构建 RAG 提示词
   * @param {string} query - 用户查询
   * @param {string} context - 检索上下文
   * @returns {string} 增强后的提示词
   */
  buildRagPrompt(query, context) {
    if (!context) {
      return query;
    }

    return `以下是一些可能对你有帮助的参考资料：

${context}

请根据以上参考资料回答用户的问题。如果参考资料中没有相关信息，请根据你的知识回答，但要说明这是你自己的理解。

用户问题：${query}`;
  }

  /**
   * RAG 增强的对话
   * @param {string} message - 用户消息
   * @param {Object[]} history - 对话历史
   * @param {Object} options - RAG 选项
   * @returns {Promise<Object>} 回复结果
   */
  async chat(message, history = [], options = {}) {
    // 1. 检索相关文档
    const relevantDocs = await this.retrieve(message, options);

    // 2. 构建上下文
    const context = this.buildContext(relevantDocs);

    // 3. 构建增强提示词
    const enhancedMessage = this.buildRagPrompt(message, context);

    // 4. 调用 LLM
    const result = await this.xunfeiService.getCompletion(enhancedMessage, history);

    return {
      reply: result.content,
      isMock: result.isMock,
      sources: relevantDocs.map(d => ({
        id: d.id,
        title: d.metadata?.title,
        category: d.metadata?.category
      })),
      model: config.xunfei.model
    };
  }

  /**
   * RAG 增强的流式对话
   * @param {string} message - 用户消息
   * @param {Object[]} history - 对话历史
   * @param {Object} options - RAG 选项
   * @yields {Object} 流式响应块
   */
  async *chatStream(message, history = [], options = {}) {
    // 1. 检索相关文档
    const relevantDocs = await this.retrieve(message, options);

    // 2. 构建上下文
    const context = this.buildContext(relevantDocs);

    // 3. 构建增强提示词
    const enhancedMessage = this.buildRagPrompt(message, context);

    // 4. 如果有检索结果，先发送来源信息
    if (relevantDocs.length > 0) {
      yield {
        type: 'sources',
        sources: relevantDocs.map(d => ({
          id: d.id,
          title: d.metadata?.title
        }))
      };
    }

    // 5. 流式调用 LLM
    for await (const chunk of this.xunfeiService.getCompletionStream(enhancedMessage, history)) {
      yield {
        type: 'content',
        content: chunk.content,
        done: chunk.done
      };
    }
  }
}

module.exports = { RagService };
