const axios = require('axios');

class SummaryService {
  constructor() {
    this.apiKey = 'a8857c7cb2aa4d80c9ce33f202577974:NDk1YjUxNTA2MGYxM2E2YzY5M2Y1OTI5';
    this.baseUrl = 'https://spark-api-open.xf-yun.com/v1/chat/completions';
    this.model = 'generalv3.5';
  }

  /**
   * 将早期对话历史压缩成摘要
   */
  async summarize(messages) {
    if (!messages || messages.length === 0) {
      return '';
    }

    const conversationText = messages
      .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
      .join('\n');

    const systemPrompt = `你是一个对话摘要助手。请将以下对话历史压缩成一段简洁的摘要，保留关键信息、重要决策和上下文要点。摘要应该：
1. 简洁明了，不超过200字
2. 保留重要的上下文信息
3. 突出关键决策和结论
4. 使用第三人称描述`;

    const payload = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请总结以下对话：\n\n${conversationText}` }
      ],
      temperature: 0.3,
      max_tokens: 300
    };

    try {
      console.log('[摘要服务] 正在生成摘要...');
      const response = await axios.post(this.baseUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        timeout: 30000
      });

      const summary = response.data?.choices?.[0]?.message?.content || '';
      console.log(`[摘要服务] 摘要生成成功，长度: ${summary.length}`);
      return summary;
    } catch (error) {
      console.error('[摘要服务] 生成失败:', error.message);
      return `[历史对话摘要: ${messages.length}条消息，包含用户与助手的交流记录]`;
    }
  }

  /**
   * 判断是否需要生成摘要
   */
  shouldSummarize(messageCount, threshold = 15) {
    return messageCount > threshold;
  }

  /**
   * 分割消息：返回需要摘要的部分和保留的部分
   */
  splitMessages(messages, keepRecent = 10) {
    if (messages.length <= keepRecent) {
      return { toSummarize: [], toKeep: messages };
    }

    const toSummarize = messages.slice(0, messages.length - keepRecent);
    const toKeep = messages.slice(messages.length - keepRecent);

    return { toSummarize, toKeep };
  }
}

module.exports = { SummaryService };
