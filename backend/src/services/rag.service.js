"use strict";

const { AiService } = require('./ai.service');
const { ChatdocService } = require('./chatdoc.service');
const { DocumentService } = require('./document.service');
const { EmbeddingService } = require('./embedding.service');
const config = require('../config');
const { metrics } = require('./metrics.service');

class RagService {
  constructor(aiService = null) {
    this.aiService = aiService || new AiService();
    this.chatdocService = new ChatdocService();
    this.documentService = new DocumentService();
    this.embeddingService = new EmbeddingService();
    this.maxContextLength = 6000;
    this.parentChildEnabled = true;
    // Rerank 精排配置
    this.rerankEnabled = true;
    this.rerankTopK = 3;
  }

  /**
   * 父子文档召回：将 ChatDoc 返回的 fileRefer 映射为本地完整父文档上下文
   */
  async assembleParentContext(fileRefer) {
    if (!fileRefer || Object.keys(fileRefer).length === 0) {
      return { sources: [], context: '', parentDocs: [] };
    }

    const matchedFileIds = Object.keys(fileRefer);
    const matchedIndices = Object.values(fileRefer);

    const parentDocs = await this._fetchParentDocuments(matchedFileIds);

    if (parentDocs.length === 0) {
      return { sources: [], context: '', parentDocs: [] };
    }

    const contextParts = [];
    const sources = [];
    let totalLength = 0;

    for (let i = 0; i < parentDocs.length; i++) {
      const doc = parentDocs[i];
      const chunkIndices = matchedIndices[i] || [];

      const header = `【文档 ${i + 1}】${doc.title}`;
      const summaryPrefix = doc.metadata?.summary
        ? `\n摘要：${doc.metadata.summary}\n`
        : '\n';
      const fullContent = doc.content || '';

      const entry = `${header}${summaryPrefix}\n${fullContent}`;
      const entryLength = entry.length;

      if (totalLength + entryLength > this.maxContextLength) {
        const remaining = this.maxContextLength - totalLength;
        if (remaining > 200) {
          contextParts.push(entry.substring(0, remaining) + '\n...(内容过长已截断)');
        }
        break;
      }

      contextParts.push(entry);
      totalLength += entryLength;

      sources.push({
        id: doc.id,
        title: doc.title,
        category: doc.category,
        chunkCount: doc.chunkCount,
        matchedChunks: chunkIndices.length,
        chatdocFileId: doc.chatdocFileId
      });
    }

    const context = contextParts.join('\n\n' + '='.repeat(40) + '\n\n');

    return { sources, context, parentDocs };
  }

  /**
   * 从本地 MemoryStore 批量拉取父文档
   */
  async _fetchParentDocuments(fileIds) {
    if (!fileIds || fileIds.length === 0) return [];

    try {
      const allDocIds = await this.documentService._getAllDocIds();
      const matchedDocIds = [];
      for (const docId of allDocIds) {
        const meta = await this.documentService._getDocMeta(docId);
        if (meta && meta.chatdocFileId && fileIds.includes(meta.chatdocFileId)) {
          matchedDocIds.push(docId);
        }
      }

      if (matchedDocIds.length === 0) return [];

      const pipeline = require('../services/memory-store').store.pipeline();
      matchedDocIds.forEach(id => {
        pipeline.hgetall(`document:${id}`);
      });
      const results = await pipeline.exec();

      return results
        .map(([err, data]) => data)
        .filter(d => d && d.id)
        .map(d => ({
          id: d.id,
          title: d.title,
          category: d.category,
          content: d.content || '',
          contentLength: parseInt(d.contentLength) || 0,
          chunkCount: parseInt(d.chunkCount) || 0,
          chatdocFileId: d.chatdocFileId || '',
          createdAt: parseInt(d.createdAt) || 0,
          metadata: d.metadata ? JSON.parse(d.metadata) : {}
        }));
    } catch (err) {
      console.warn(`[RAG] 拉取父文档失败: ${err.message}`);
      return [];
    }
  }

  /**
   * 构建父子召回增强的 RAG Prompt
   */
  buildParentChildPrompt(query, context) {
    if (!context) return query;

    return `你是一个专业的技术助手。以下是 retrieved 的相关文档完整内容，请根据这些资料准确回答用户的问题。

注意：
1. 优先使用提供的文档内容回答，不要编造文档中没有的信息
2. 如果文档内容不足以回答问题，可以结合你的知识补充，但要明确标注
3. 回答时引用具体文档编号，方便用户溯源

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
参考资料：
${context}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户问题：${query}`;
  }

  /**
   * 星火知识库问答 — 结合父子召回增强 + Rerank 精排
   */
  async chatdocChat(message, history = [], options = {}) {
    const totalStart = Date.now();
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

    // 第一阶段：ChatDoc 检索 + 原生生成
    const chatdocStart = Date.now();
    const result = await this.chatdocService.chat(fileIds, messages, options);
    const chatdocLatency = Date.now() - chatdocStart;
    metrics.recordLatency('chatdoc', chatdocLatency);

    // Rerank 精排：对 ChatDoc 返回的候选做二次打分
    let effectiveFileRefer = result.fileRefer;
    if (this.rerankEnabled && result.fileRefer) {
      const rerankStart = Date.now();
      const reranked = await this.rerank(message, result.fileRefer, this.rerankTopK);
      metrics.recordLatency('rerank', Date.now() - rerankStart);
      if (reranked && Object.keys(reranked).length > 0) {
        effectiveFileRefer = reranked;
      }
    }

    // 父子召回：用 ChatDoc 的 fileRefer 从本地拉取完整父文档
    let enhancedContext = '';
    let parentSources = [];
    let parentChildLatency = 0;
    if (this.parentChildEnabled && effectiveFileRefer) {
      try {
        const pcStart = Date.now();
        const { context, sources } = await this.assembleParentContext(effectiveFileRefer);
        parentChildLatency = Date.now() - pcStart;
        metrics.recordLatency('parentChild', parentChildLatency);
        enhancedContext = context;
        parentSources = sources;
        if (sources.length > 0) {
          console.log(`[Metrics] 父子召回增强: ${sources.length} 篇父文档, ${parentChildLatency}ms`);
        }
      } catch (err) {
        console.warn(`[Metrics] 父子召回失败: ${err.message}`);
      }
    }

    // 如果有增强上下文，用本地 LLM 重新生成更准确的答案
    let reply = result.content;
    let aiLatency = 0;
    if (enhancedContext) {
      try {
        const aiStart = Date.now();
        const enhancedPrompt = this.buildParentChildPrompt(message, enhancedContext);
        const llmResult = await this.aiService.getCompletion(enhancedPrompt, history);
        aiLatency = Date.now() - aiStart;
        reply = llmResult.content;
      } catch (err) {
        console.warn(`[Metrics] 增强生成失败: ${err.message}`);
      }
    }

    const totalLatency = Date.now() - totalStart;
    metrics.recordLatency('total', totalLatency);

    // RAG 查询统计
    const matchedDocs = parentSources.length;
    const retrievedChunks = Object.values(effectiveFileRefer || {}).reduce((s, arr) => s + (arr?.length || 0), 0);
    metrics.recordRagQuery({
      usedRag: true,
      usedParentChild: !!enhancedContext,
      matchedDocs,
      retrievedChunks
    });

    const sources = parentSources.length > 0
      ? parentSources
      : this._buildBasicSources(effectiveFileRefer);

    return {
      reply,
      isMock: false,
      sources,
      context: enhancedContext,
      model: 'chatdoc+parent-child',
      _metrics: {
        totalLatency,
        chatdocLatency,
        parentChildLatency,
        aiLatency,
        matchedDocs,
        retrievedChunks
      }
    };
  }

  /**
   * 从 fileRefer 构建基础 sources（无父文档时的降级展示）
   */
  _buildBasicSources(fileRefer) {
    if (!fileRefer) return [];
    return Object.entries(fileRefer).map(([fileId, indices]) => ({
      id: fileId,
      title: '星火知识库文档',
      chunks: indices,
      chatdocFileId: fileId
    }));
  }

  // ==================== Rerank 精排 ====================

  /**
   * 混合 Reranker — 优先 embedding 语义相似度，降级到关键词匹配
   *
   * 打分策略：
   *   1. 尝试用 Embedding API 计算 query 与文档标题/内容的余弦相似度
   *   2. 如果 embedding 不可用（无 API key 或调用失败），回退到关键词匹配
   *   3. 双模式可用时：finalScore = embeddingScore * 0.7 + keywordScore * 0.3
   *
   * @param {string} query
   * @param {Object} fileRefer
   * @param {number} topK
   * @returns {Object}
   */
  async rerank(query, fileRefer, topK = 3) {
    if (!fileRefer || Object.keys(fileRefer).length === 0) return fileRefer;

    const entries = Object.entries(fileRefer);
    if (entries.length <= topK) return fileRefer;

    let useEmbedding = this.embeddingService.isAvailable;
    let queryEmbedding = null;

    if (useEmbedding) {
      queryEmbedding = await this.embeddingService.embed(query);
      if (!queryEmbedding) useEmbedding = false;
    }

    const queryTerms = useEmbedding ? null : this._extractQueryTerms(query);
    const useKeyword = !useEmbedding && queryTerms.length > 0;

    if (!useEmbedding && !useKeyword) return fileRefer;

    const scored = [];
    for (const [fileId, chunkIndices] of entries) {
      const { embeddingScore, keywordScore } = await this._scoreCandidate(
        queryEmbedding, queryTerms, fileId, chunkIndices
      );
      const finalScore = useEmbedding && useKeyword
        ? embeddingScore * 0.7 + keywordScore * 0.3
        : useEmbedding ? embeddingScore : keywordScore;
      scored.push({ fileId, chunkIndices, score: finalScore });
    }

    scored.sort((a, b) => b.score - a.score);
    const topEntries = scored.slice(0, topK);

    const reranked = {};
    for (const entry of topEntries) {
      reranked[entry.fileId] = entry.chunkIndices;
    }
    return reranked;
  }

  /**
   * 对单个候选文档打分
   * @returns {{ embeddingScore: number, keywordScore: number }}
   */
  async _scoreCandidate(queryEmbedding, queryTerms, fileId, chunkIndices) {
    let embeddingScore = 0;
    let keywordScore = 0;

    try {
      const meta = await this.documentService._getDocMeta(fileId);
      if (!meta) return { embeddingScore: 0, keywordScore: 0 };

      const title = meta.title || '';
      const category = meta.category || '';
      const content = meta.content || '';
      const matchedChunks = chunkIndices ? chunkIndices.length : 0;

      // 1. Embedding 语义相似度（主要信号）
      if (queryEmbedding) {
        const [titleEmb, contentEmb] = await this.embeddingService.embedBatch([
          title, content.slice(0, 2000)
        ]);
        const titleSim = EmbeddingService.cosineSimilarity(queryEmbedding, titleEmb) || 0;
        const contentSim = EmbeddingService.cosineSimilarity(queryEmbedding, contentEmb) || 0;
        embeddingScore = titleSim * 0.4 + contentSim * 0.6;
      }

      // 2. 关键词匹配（降级方案）
      if (queryTerms) {
        const lt = title.toLowerCase();
        const lc = category.toLowerCase();
        const lct = content.toLowerCase();

        let s = 0;
        s += (queryTerms.filter(t => lt.includes(t)).length / queryTerms.length) * 0.4;
        s += (queryTerms.filter(t => lc.includes(t)).length / queryTerms.length) * 0.1;
        s += (queryTerms.filter(t => lct.includes(t)).length / queryTerms.length) * 0.3;
        s += Math.min(matchedChunks / 5, 1.0) * 0.2;
        keywordScore = Math.min(s, 1.0);
      }
    } catch {
      // 单文档打分失败，返回 0
    }

    return { embeddingScore, keywordScore };
  }

  /**
   * 从查询中提取关键词（仅作降级 fallback）
   */
  _extractQueryTerms(query) {
    const terms = new Set();

    // 英文单词（>= 2 字符）
    const englishWords = query.match(/[a-zA-Z]{2,}/g) || [];
    englishWords.forEach(w => terms.add(w.toLowerCase()));

    // 中文词组（1-4 字）
    const chinesePhrases = query.match(/[一-鿿]{1,4}/g) || [];
    chinesePhrases.forEach(p => terms.add(p));

    // 数字（课程编号、错误码等）
    const numbers = query.match(/\d+/g) || [];
    numbers.forEach(n => terms.add(n));

    return [...terms];
  }

  /**
   * RAG 增强的对话 — 父子召回增强 + Rerank 精排
   */
  async chat(message, history = [], options = {}) {
    const totalStart = Date.now();
    let usedRag = false;

    try {
      const result = await this.chatdocChat(message, history, options);
      if (result) {
        usedRag = true;
        if (!result._metrics) {
          metrics.recordLatency('total', Date.now() - totalStart);
        }
        return result;
      }
    } catch (err) {
      console.warn(`[Metrics] RAG 对话失败: ${err.message}`);
    }

    // 无知识库文档时直接问答
    const aiStart = Date.now();
    const result = await this.aiService.getCompletion(message, history);
    metrics.recordLatency('ai', Date.now() - aiStart);
    metrics.recordLatency('total', Date.now() - totalStart);
    metrics.recordRagQuery({ usedRag: false, usedParentChild: false });

    return {
      reply: result.content,
      isMock: result.isMock,
      sources: [],
      context: '',
      model: config.ai.model || 'Qwen3.6-35B-A3B'
    };
  }

  /**
   * RAG 增强的流式对话 — 父子召回增强 + Rerank 精排
   */
  async *chatStream(message, history = [], options = {}) {
    const totalStart = Date.now();
    const fileIds = await this.documentService.getAllChatdocFileIds();

    if (fileIds.length > 0) {
      try {
        console.log(`[Metrics] 使用父子召回增强, ${fileIds.length} 个文档`);

        const messages = [];
        for (const h of history.slice(-10)) {
          messages.push({
            role: h.role === 'assistant' ? 'assistant' : 'user',
            content: h.content
          });
        }
        messages.push({ role: 'user', content: message });

        // 第一步：调用 ChatDoc 获取检索结果（用于 fileRefer）
        const chatdocStart = Date.now();
        const chatdocResult = await this.chatdocService.chat(fileIds, messages, options);
        const chatdocLatency = Date.now() - chatdocStart;
        metrics.recordLatency('chatdoc', chatdocLatency);

        // Rerank 精排
        let effectiveFileRefer = chatdocResult.fileRefer;
        if (this.rerankEnabled && chatdocResult.fileRefer) {
          const rerankStart = Date.now();
          effectiveFileRefer = await this.rerank(message, chatdocResult.fileRefer, this.rerankTopK);
          metrics.recordLatency('rerank', Date.now() - rerankStart);
        }

        // 第二步：父子召回 — 用 fileRefer 拉取完整父文档
        let enhancedContext = '';
        let parentSources = [];
        let parentChildLatency = 0;
        if (this.parentChildEnabled && effectiveFileRefer) {
          try {
            const pcStart = Date.now();
            const { context, sources } = await this.assembleParentContext(effectiveFileRefer);
            parentChildLatency = Date.now() - pcStart;
            metrics.recordLatency('parentChild', parentChildLatency);
            enhancedContext = context;
            parentSources = sources;
            if (sources.length > 0) {
              console.log(`[Metrics] 父子召回增强: ${sources.length} 篇, ${parentChildLatency}ms`);
            }
          } catch (err) {
            console.warn(`[Metrics] 父子召回失败: ${err.message}`);
          }
        }

        // 记录 RAG 查询
        const matchedDocs = parentSources.length;
        const retrievedChunks = Object.values(effectiveFileRefer || {}).reduce((s, arr) => s + (arr?.length || 0), 0);
        metrics.recordRagQuery({
          usedRag: true,
          usedParentChild: !!enhancedContext,
          matchedDocs,
          retrievedChunks
        });

        // 发送增强的 sources（父文档信息）
        if (parentSources.length > 0) {
          yield { type: 'sources', sources: parentSources };
        } else if (effectiveFileRefer) {
          yield { type: 'sources', sources: this._buildBasicSources(effectiveFileRefer) };
        }

        // 第三步：用增强上下文调用 LLM 流式生成
        if (enhancedContext) {
          const aiStart = Date.now();
          const enhancedPrompt = this.buildParentChildPrompt(message, enhancedContext);
          for await (const chunk of this.aiService.getCompletionStream(enhancedPrompt, history)) {
            yield {
              type: 'content',
              content: chunk.content,
              done: chunk.done
            };
          }
          metrics.recordLatency('ai', Date.now() - aiStart);
        } else {
          // 无增强上下文时，使用 ChatDoc 原生流式结果
          for await (const chunk of this.chatdocService.chatStream(fileIds, messages, options)) {
            if (chunk.type === 'sources') {
              const sources = [];
              // 使用 rerank 后的 fileRefer（若可用）
              const fileReferToUse = effectiveFileRefer || chunk.fileRefer;
              if (fileReferToUse) {
                for (const [fileId, indices] of Object.entries(fileReferToUse)) {
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
        }

        metrics.recordLatency('total', Date.now() - totalStart);
        return;
      } catch (err) {
        console.warn(`[Metrics] 父子召回流式失败，降级: ${err.message}`);
      }
    }

    // 无知识库时直接问答
    const aiStart = Date.now();
    for await (const chunk of this.aiService.getCompletionStream(message, history)) {
      yield {
        type: 'content',
        content: chunk.content,
        done: chunk.done
      };
    }
    metrics.recordLatency('ai', Date.now() - aiStart);
    metrics.recordLatency('total', Date.now() - totalStart);
    metrics.recordRagQuery({ usedRag: false, usedParentChild: false });
  }
}

module.exports = { RagService, metrics };
