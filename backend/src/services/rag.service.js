"use strict";

const { AnthropicService } = require('./anthropic.service');
const { ChatdocService } = require('./chatdoc.service');
const { DocumentService } = require('./document.service');
const config = require('../config');

class RagService {
  constructor() {
    this.anthropicService = new AnthropicService();
    this.chatdocService = new ChatdocService();
    this.documentService = new DocumentService();
    this.maxContextLength = 2000;
  }

  /**
   * 构建增强上下文（用于本地关键词检索降级）
   */
  buildContext(documents) {
    if (!documents || documents.length === 0) return '';
    let context = '';
    let totalLength = 0;
    for (const doc of documents) {
      const content = doc.content || '';
      const entry = `【相关资料】\n${content}\n`;
      if (totalLength + entry.length > this.maxContextLength) break;
      context += entry + '---\n';
      totalLength += entry.length;
    }
    return context;
  }

  buildRagPrompt(query, context) {
    if (!context) return query;
    return `以下是一些可能对你有帮助的参考资料：

${context}

请根据以上参考资料回答用户的问题。如果参考资料中没有相关信息，请根据你的知识回答，但要说明这是你自己的理解。

用户问题：${query}`;
  }

  /**
   * 星火知识库问答
   */
  async chatdocChat(message, history = [], options = {}) {
    const fileIds = await this.documentService.getAllChatdocFileIds();
    if (fileIds.length === 0) return null;

    const messages = [];
    for (const h of history.slice(-10)) {
      messages.push({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.content
      });
    }
    messages.push({ role: 'user', content: message });

    const result = await this.chatdocService.chat(fileIds, messages, options);

    const sources = [];
    if (result.fileRefer) {
      for (const [fileId, indices] of Object.entries(result.fileRefer)) {
        sources.push({ id: fileId, title: '星火知识库文档', chunks: indices });
      }
    }

    return {
      reply: result.content,
      isMock: false,
      sources,
      model: 'chatdoc'
    };
  }

  /**
   * RAG 增强的对话
   */
  async chat(message, history = [], options = {}) {
    try {
      const result = await this.chatdocChat(message, history, options);
      if (result) return result;
    } catch (err) {
      console.warn(`[RAG] 星火知识库问答失败: ${err.message}`);
    }

    // 无知识库文档时直接问答
    const result = await this.anthropicService.getCompletion(message, history);
    return {
      reply: result.content,
      isMock: result.isMock,
      sources: [],
      model: config.xunfei.model
    };
  }

  /**
   * RAG 增强的流式对话
   */
  async *chatStream(message, history = [], options = {}) {
    const fileIds = await this.documentService.getAllChatdocFileIds();

    if (fileIds.length > 0) {
      try {
        console.log(`[RAG] 使用星火知识库问答, ${fileIds.length} 个文档`);

        const messages = [];
        for (const h of history.slice(-10)) {
          messages.push({
            role: h.role === 'assistant' ? 'assistant' : 'user',
            content: h.content
          });
        }
        messages.push({ role: 'user', content: message });

        yield { type: 'sources', sources: fileIds.map(id => ({ id, title: '星火知识库' })) };

        for await (const chunk of this.chatdocService.chatStream(fileIds, messages, options)) {
          if (chunk.type === 'sources') {
            const sources = [];
            if (chunk.fileRefer) {
              for (const [fileId, indices] of Object.entries(chunk.fileRefer)) {
                sources.push({ id: fileId, title: '星火知识库文档', chunks: indices });
              }
            }
            if (sources.length > 0) {
              yield { type: 'sources', sources };
            }
          } else if (chunk.type === 'content') {
            yield { type: 'content', content: chunk.content, done: false };
          } else if (chunk.type === 'error') {
            yield { type: 'content', content: `[错误: ${chunk.content}]`, done: false };
          }
        }

        yield { type: 'content', content: '', done: true };
        return;
      } catch (err) {
        console.warn(`[RAG] 星火知识库问答失败，降级到普通模式: ${err.message}`);
      }
    }

    // 无知识库时直接问答
    for await (const chunk of this.anthropicService.getCompletionStream(message, history)) {
      yield {
        type: 'content',
        content: chunk.content,
        done: chunk.done
      };
    }
  }
}

module.exports = { RagService };
