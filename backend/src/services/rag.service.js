"use strict";

const { AiService } = require('./ai.service');
const { DocumentService } = require('./document.service');
const { EmbeddingService } = require('./embedding.service');
const { vectorStore: vectorStoreSingleton } = require('./vector-store.service');
const { RerankerService } = require('./reranker.service');
const config = require('../config');
const { metrics } = require('./metrics.service');
const { RagTracer } = require('./rag-tracer.service');
const { logEvent } = require('./observability.service');
const {
  QUESTION_TYPE,
  TYPE_CONFIG,
  DOC_CATEGORY_KEYWORDS,
  classifyQuestion,
  getTypeConfig,
  inferDocCategory,
  adaptiveTruncate,
  charBigrams,
  jaccardBigrams,
  mmrDedupe,
} = require('./rag-ranking.service');
const ragPrompt = require('./rag-prompt.service');
const resultMapper = require('./rag-result-mapper.service');
const { QueryCache } = require('../utils/query-cache');

// 检索结果缓存 + query rewrite 缓存（模块级单例）
const retrievalCache = new QueryCache(
  config.rag.cacheMaxEntries || 500,
  config.rag.cacheTtlMs || 300000,
);
const rewriteCache = new QueryCache(
  config.rag.rewriteCacheMaxEntries || 500,
  config.rag.cacheTtlMs || 300000,
);

class RagService {
  constructor(aiService = null) {
    const ragConfig = config.rag || {};

    this.aiService = aiService || new AiService();
    this.documentService = new DocumentService();
    this.embeddingService = new EmbeddingService();
    // 使用全局单例，避免创建新实例导致向量为空
    this.vectorStore = vectorStoreSingleton;
    this.maxContextLength = ragConfig.maxContextLength || 6000;
    this.parentChildEnabled = ragConfig.parentChildEnabled !== false;
    this.rerankEnabled = ragConfig.rerankEnabled !== false;
    this.rerankTopK = ragConfig.rerankTopK || 10;
    this.searchTopK = ragConfig.searchTopK || 50;
    this.keywordTopK = ragConfig.keywordTopK || 20;
    this.hybridSearchEnabled = ragConfig.hybridSearchEnabled !== false;
    this.rrfK = ragConfig.rrfK || 60;
    this.minSourceScore = ragConfig.minSourceScore ?? 0.03;
    this.mmrEnabled = ragConfig.mmrEnabled !== false;
    this.mmrLambda = ragConfig.mmrLambda ?? 0.7;
    this.mmrMaxSim = ragConfig.mmrMaxSim ?? 0.85;
    this.autoCategoryFilter = ragConfig.autoCategoryFilter !== false;
    this.rerankerService = new RerankerService();
  }

  _createTracer(message, options = {}) {
    return options.tracer || new RagTracer({
      traceId: options.traceId,
      userId: options.userId,
      conversationId: options.conversationId,
      message,
      category: options.category || null,
    });
  }

  _recordTraceStage(tracer, name, startedAt, success = true, details = {}, err = null) {
    const durationMs = Date.now() - startedAt;
    tracer?.recordStage(name, durationMs, success, details, err);
    if (typeof metrics.recordStage === 'function') {
      metrics.recordStage(name, durationMs, success, err ? this._errorType(err) : null);
    }
    return durationMs;
  }

  _finishTrace(tracer, result = {}, outcome = {}) {
    const trace = tracer.finish(outcome);
    return {
      ...result,
      traceId: trace.traceId,
      trace: tracer.toSummary(),
    };
  }

  _errorType(err) {
    const message = String(err?.message || err || '').toLowerCase();
    if (/timeout|timed out|abort/.test(message)) return 'timeout';
    if (/rate|429|quota|limit/.test(message)) return 'rate_limit';
    if (/qdrant|向量库|vector|collection/.test(message)) return 'vector_store';
    if (/embedding|transformer|model/.test(message)) return 'embedding';
    if (/network|econn|enotfound|socket|fetch/.test(message)) return 'network';
    return 'unknown';
  }

  /**
   * 统一 RAG 管道编排:文档检查 → 检索 → rerank → 父段处理 → 上下文组装
   *
   * @param {string} message - 用户消息
   * @param {Array} history - 历史消息
   * @param {Object} options - 选项
   * @param {RagTracer} options.tracer - tracer 实例
   * @param {Function} [options.onEvent] - 流式回调,收到事件时调用 ({type, ...data})
   * @returns {Promise<Object>} { context, sources, topChunks, retrieval, questionType, rewrittenQuery, hasReliableCandidates }
   */
  async _runRAGPipeline(message, history = [], options = {}) {
    const { onEvent, tracer } = options;
    const totalStart = Date.now();
    const questionType = this.classifyQuestion(message);

    // 文档检查
    const docsStart = Date.now();
    const hasDocs = await this.documentService.hasDocuments(options.category);
    this._recordTraceStage(tracer, 'document_check', docsStart, true, {
      docCount: hasDocs ? 1 : 0,
      category: options.category || null,
    });

    if (!hasDocs) {
      tracer?.markFallback('no_documents');
      if (tracer) tracer.finish({ usedRag: false, fallbackReason: 'no_documents' });
      return {
        context: '',
        sources: [],
        topChunks: [],
        retrieval: { channels: [], hasResults: false },
        questionType,
        rewrittenQuery: '',
        hasReliableCandidates: false,
        fallbackReason: 'no_documents',
      };
    }

    // 检索
    const { candidates, trace, rewrittenQuery } = await this._dualRetrieve(message, history, options);

    if (!this._hasReliableCandidates(candidates)) {
      const retrievalSummary = this._summarizeRetrievalTrace(trace);
      tracer?.setRetrieval(retrievalSummary);
      tracer?.markFallback('no_reliable_sources');
      this._recordTraceStage(tracer, 'total', totalStart, true, {
        usedRag: true,
        matchedDocs: 0,
        retrievedChunks: 0,
      });

      if (onEvent) {
        onEvent({ type: 'retrieval', retrieval: retrievalSummary, questionType, rewrittenQuery });
        onEvent({ type: 'no_reliable_sources', reply: this._buildNoReliableSourcesReply() });
      }

      return {
        context: '',
        sources: [],
        topChunks: [],
        retrieval: retrievalSummary,
        questionType,
        rewrittenQuery,
        hasReliableCandidates: false,
        fallbackReason: 'no_reliable_sources',
      };
    }

    if (onEvent) {
      const retrievalSummary = this._summarizeRetrievalTrace(trace);
      tracer?.setRetrieval(retrievalSummary);
      onEvent({ type: 'retrieval', retrieval: retrievalSummary, questionType, rewrittenQuery });
    }

    // 子句选择
    const rerankStart = Date.now();
    const topChunks = await this.selectTopChunks(message, candidates);
    const childSelectLatency = Date.now() - rerankStart;
    metrics.recordLatency('rerank', childSelectLatency);
    this._recordTraceStage(tracer, 'child_select', rerankStart, true, {
      inputCount: candidates.length,
      outputCount: topChunks.length,
    });

    // 父段处理
    let enhancedContext = '';
    let parentSources = [];
    if (this.parentChildEnabled && topChunks.length > 0) {
      try {
        const pcStart = Date.now();

        // 1. 子句按父段落聚合
        const paraMap = this._groupChunksByParent(topChunks);
        let parentCandidates = [...paraMap.values()];

        // 2. cross-encoder rerank 父段落
        if (this.rerankEnabled && parentCandidates.length > 1) {
          const RERANK_MAX_INPUT = 20;
          parentCandidates.sort((a, b) => (b.bestChunk?.score || 0) - (a.bestChunk?.score || 0));
          const rerankCandidates = parentCandidates.slice(0, RERANK_MAX_INPUT);
          const rerankInput = rerankCandidates.map(m => ({
            text: m.parentText || m.bestChunk?.text || '',
            score: m.bestChunk?.score || 0,
            _match: m,
          }));
          const parentRerankStart = Date.now();
          const allRanked = await this.rerankerService.rerank(message, rerankInput, parentCandidates.length);
          this._recordTraceStage(tracer, 'rerank', parentRerankStart, true, {
            inputCount: rerankInput.length,
            outputCount: allRanked.length,
            model: allRanked[0]?._rerankModel || 'bge-reranker-base',
          });
          parentCandidates = allRanked.map(r => ({ ...r._match, _rerankScore: r._rerankScore, _rerankModel: r._rerankModel }));
        }

        // 3. 自适应截断
        const truncateOverrides = this._evalOverrides(options);
        parentCandidates = this._adaptiveTruncate(parentCandidates, this.rerankTopK, message, truncateOverrides);

        // 3.5 MMR 去重
        const mmrStart = Date.now();
        const beforeDedup = parentCandidates.length;
        parentCandidates = this._mmrDedupe(parentCandidates, this.rerankTopK);
        if (parentCandidates.length < beforeDedup) {
          console.log(`[RAG] MMR 去重: ${beforeDedup} → ${parentCandidates.length} 个父段`);
        }
        this._recordTraceStage(tracer, 'parent_dedup', mmrStart, true, {
          before: beforeDedup,
          after: parentCandidates.length,
          method: 'mmr',
        });

        // 4. 按 (docId, parentIdx) 二级排序
        parentCandidates.sort((a, b) => {
          const docCmp = (a.docId || '').localeCompare(b.docId || '');
          if (docCmp !== 0) return docCmp;
          return (a.parentIdx ?? 0) - (b.parentIdx ?? 0);
        });

        // 5. 组装上下文（由 maxContextLength 控制长度）
        const { context, sources } = await this._buildContextFromParents(parentCandidates, truncateOverrides);
        enhancedContext = context;
        parentSources = sources;

        metrics.recordLatency('parentChild', Date.now() - pcStart);
        this._recordTraceStage(tracer, 'parent_child', pcStart, true, {
          inputChunks: topChunks.length,
          parentCount: parentSources.length,
          contextLength: enhancedContext.length,
        });
      } catch (err) {
        this._recordTraceStage(tracer, 'parent_child', Date.now(), false, {}, err);
        console.warn(`[RAG] 父子召回失败: ${err.message}`);
      }
    }

    const retrievalSummary = this._summarizeRetrievalTrace(trace);
    this._recordTraceStage(tracer, 'total', totalStart, true, {
      usedRag: true,
      matchedDocs: parentSources.length,
      retrievedChunks: topChunks.length,
    });

    if (onEvent) {
      onEvent({ type: 'sources', sources: parentSources.length > 0 ? parentSources : topChunks.slice(0, this.rerankTopK).map(c => this._chunkToSource(c)) });
    }

    return {
      context: enhancedContext,
      sources: parentSources,
      topChunks,
      retrieval: retrievalSummary,
      questionType,
      rewrittenQuery,
      hasReliableCandidates: true,
    };
  }

  /**
   * 本地混合检索管道 (流式)
   */
  /**
   * 本地混合检索管道 (非流式,兼容 Agent 工具)
   */
  async localSearchChat(message, history = [], options = {}) {
    const tracer = this._createTracer(message, options);
    const ownsTracer = !options.tracer;
    const totalStart = Date.now();

    const pipeline = await this._runRAGPipeline(message, history, { ...options, tracer });

    if (!pipeline.hasReliableCandidates) {
      return ownsTracer ? this._finishTrace(tracer, {
        reply: pipeline.fallbackReason === 'no_documents' ? null : this._buildNoReliableSourcesReply(),
        isMock: false,
        sources: [],
        context: '',
        topChunks: [],
        model: 'local-hybrid-search+no-source',
        questionType: pipeline.questionType,
        rewrittenQuery: pipeline.rewrittenQuery,
        retrieval: pipeline.retrieval,
      }) : null;
    }

    // retrieveOnly:仅检索不生成(Agent 工具专用)
    if (options.retrieveOnly) {
      const result = {
        reply: '',
        isMock: false,
        sources: pipeline.sources,
        context: pipeline.context,
        model: 'local-hybrid-search+retrieve-only',
        questionType: pipeline.questionType,
        rewrittenQuery: pipeline.rewrittenQuery,
        retrieval: pipeline.retrieval,
      };
      return ownsTracer ? this._finishTrace(tracer, result) : { ...result, traceId: tracer.traceId, trace: tracer.toSummary() };
    }

    // 生成回答
    let reply = '';
    let aiLatency = 0;
    let llmUsage = null;
    let llmModel = config.ai.model || 'step-3.7-flash';
    let processCard = null;
    if (pipeline.context) {
      const aiStart = Date.now();
      try {
        const isProcess = this.isProcessQuestion(message);
        const enhancedPrompt = isProcess
          ? this.buildProcessPrompt(message, pipeline.context)
          : this.buildParentChildPrompt(message, pipeline.context);
        const llmResult = await this.aiService.getCompletion(enhancedPrompt, history);
        aiLatency = Date.now() - aiStart;
        this._recordTraceStage(tracer, 'llm', aiStart, true, {
          model: config.ai.model || 'step-3.7-flash',
          isMock: !!llmResult.isMock,
          outputChars: (llmResult.content || '').length,
          usage: llmResult.usage || null,
        });
        reply = llmResult.content;
        llmUsage = llmResult.usage || null;
        llmModel = llmResult.model || llmModel;
        if (isProcess) processCard = this.parseProcessCard(reply);
      } catch (err) {
        aiLatency = this._recordTraceStage(tracer, 'llm', aiStart, false, { model: config.ai.model || 'step-3.7-flash' }, err);
        console.warn(`[RAG] 增强生成失败: ${err.message}`);
        reply = this._buildNoReliableSourcesReply();
      }
    } else {
      reply = this._buildNoReliableSourcesReply();
    }

    const totalLatency = Date.now() - totalStart;
    metrics.recordLatency('total', totalLatency);
    metrics.recordRagQuery({
      usedRag: true,
      usedParentChild: !!pipeline.context,
      matchedDocs: pipeline.sources.length,
      retrievedChunks: pipeline.topChunks.length,
      hasSources: pipeline.sources.length > 0,
    });

    tracer.setRetrieval(pipeline.retrieval);
    tracer.setOutcome({
      usedRag: true,
      usedParentChild: !!pipeline.context,
      matchedDocs: pipeline.sources.length,
      retrievedChunks: pipeline.topChunks.length,
      questionType: pipeline.questionType,
      rewrittenQuery: pipeline.rewrittenQuery,
    });
    this._recordTraceStage(tracer, 'total', totalStart, true, {
      usedRag: true,
      matchedDocs: pipeline.sources.length,
      retrievedChunks: pipeline.topChunks.length,
    });

    const result = {
      reply,
      isMock: false,
      sources: pipeline.sources,
      context: pipeline.context,
      topChunks: pipeline.topChunks,
      model: llmModel,
      usage: llmUsage,
      questionType: pipeline.questionType,
      rewrittenQuery: pipeline.rewrittenQuery,
      retrieval: pipeline.retrieval,
      processCard: processCard || null,
      _metrics: {
        totalLatency,
        aiLatency,
        matchedDocs: pipeline.sources.length,
        retrievedChunks: pipeline.topChunks.length,
        questionType: pipeline.questionType,
        rewrittenQuery: pipeline.rewrittenQuery,
        retrieval: pipeline.retrieval,
      },
    };
    return ownsTracer ? this._finishTrace(tracer, result) : { ...result, traceId: tracer.traceId, trace: tracer.toSummary() };
  }

  async retrieveCandidates(query, options = {}) {
    const searchTopK = parseInt(options.topK || options.childTopK || this.searchTopK, 10) || this.searchTopK;
    const tracer = options.tracer || null;
    const queryVariant = options.queryVariant || 'primary';

    // 缓存拦截：tracer/noCache/category 存在时不缓存
    const canCache = config.rag.cacheEnabled && !tracer && !options.noCache && !options.category;
    if (canCache) {
      const cacheKey = String(query || '').trim().toLowerCase();
      const cached = retrievalCache.get(cacheKey);
      if (cached) {
        cached.trace = cached.trace || {};
        cached.trace.cacheHit = true;
        cached.trace.queryVariant = queryVariant;
        return cached;
      }
    }

    // 元数据过滤（Multi-faceted Filtering）：显式 category 优先；
    // 未指定时按问题关键词自动推断（低置信返回 null → 不设过滤，保持全库召回）
    const explicitCategory = options.category || null;
    const autoCategory = !explicitCategory ? this._inferDocCategory(query) : null;
    const effectiveCategory = explicitCategory || autoCategory || null;

    const trace = {
      mode: 'bge-small-zh-qdrant-hybrid',
      category: effectiveCategory,
      autoCategory,
      topK: {
        hybrid: searchTopK,
        final: searchTopK,
      },
      embedding: { ok: false, dense: false, sparse: false, latency: 0, model: null },
      vector: { count: 0, latency: 0, error: null, backend: 'qdrant_hybrid' },
      keyword: { enabled: false, count: 0, latency: 0, error: null },
      fused: { count: 0, topScore: 0, channels: [] },
    };

    const filter = effectiveCategory ? { category: effectiveCategory } : null;
    let candidates = [];
    let currentStage = 'embedding';
    let currentStageStart = Date.now();

    try {
      const embeddingStart = Date.now();
      currentStage = 'embedding';
      currentStageStart = embeddingStart;
      const queryEmbedding = await this.embeddingService.embedHybrid(query);
      trace.embedding = {
        ok: !!queryEmbedding?.dense,
        dense: !!queryEmbedding?.dense,
        sparse: !!queryEmbedding?.sparse && Object.keys(queryEmbedding.sparse).length > 0,
        latency: Date.now() - embeddingStart,
        model: queryEmbedding?.model || null,
      };
      metrics.recordLatency('embedding', trace.embedding.latency);
      this._recordTraceStage(tracer, 'embedding', embeddingStart, true, {
        queryVariant,
        model: trace.embedding.model,
        dense: trace.embedding.dense,
        sparse: trace.embedding.sparse,
      });

      if (queryEmbedding?.dense) {
        const searchStart = Date.now();
        currentStage = 'vector_search';
        currentStageStart = searchStart;
        // RRF 融合在 vector-store 内完成（稠密/稀疏独立排名，无需动态权重路由）
        candidates = await this.vectorStore.search(queryEmbedding, searchTopK, filter);

        // 空结果回退：自动推断的类别过滤无命中 → 回退全库检索，避免跨文档问题被误过滤
        // （显式 category 是调用方意图，不做回退）
        if (autoCategory && candidates.length === 0) {
          const fallbackStart = Date.now();
          candidates = await this.vectorStore.search(queryEmbedding, searchTopK, null);
          trace.filterFallback = {
            inferredCategory: autoCategory,
            recovered: candidates.length,
            latency: Date.now() - fallbackStart,
          };
          this._recordTraceStage(tracer, 'category_filter_fallback', fallbackStart, true, {
            inferredCategory: autoCategory,
            recovered: candidates.length,
          });
        }

        trace.vector = {
          count: candidates.length,
          latency: Date.now() - searchStart,
          error: null,
          backend: 'qdrant_hybrid',
        };
        metrics.recordLatency('vectorSearch', trace.vector.latency);
        this._recordTraceStage(tracer, 'vector_search', searchStart, true, {
          queryVariant,
          topK: searchTopK,
          count: candidates.length,
          category: effectiveCategory || null,
          autoCategory,
          backend: trace.vector.backend,
        });
      } else {
        this._recordTraceStage(tracer, 'vector_search', Date.now(), false, {
          queryVariant,
          reason: 'missing_dense_embedding',
        });
      }
    } catch (err) {
      if (currentStage === 'embedding') {
        trace.embedding.ok = false;
      } else {
        trace.vector.error = err.message;
      }
      this._recordTraceStage(tracer, currentStage, currentStageStart, false, { queryVariant }, err);
      logEvent('warn', 'rag_vector_search_failed', { error: err.message });
    }

    this._recordTraceStage(tracer, 'keyword_search', Date.now(), true, {
      queryVariant,
      enabled: false,
      count: 0,
    });

    trace.fused = {
      count: candidates.length,
      topScore: candidates[0]?.score || 0,
      channels: [...new Set(candidates.flatMap(item => item._retrievalChannels || []))],
    };

    this._recordTraceStage(tracer, 'fusion', Date.now(), true, {
      queryVariant,
      count: trace.fused.count,
      topScore: trace.fused.topScore,
      channels: trace.fused.channels,
    });

    // 缓存写入
    if (canCache) {
      const cacheKey = String(query || '').trim().toLowerCase();
      retrievalCache.set(cacheKey, { candidates, trace, rewrittenQuery: trace?.rewrittenQuery || null });
    }

    return { candidates, trace, vectorResults: candidates, keywordResults: [] };
  }

  async retrieveParentCandidates(query, options = {}) {
    const tracer = this._createTracer(query, options);
    const ownsTracer = !options.tracer;
    const childTopK = parseInt(options.childTopK || options.topK || 25, 10) || 25;
    const parentTopK = parseInt(options.parentTopK || 0, 10) || 0;
    const includeChildren = options.includeChildren !== false;
    const { candidates, trace, vectorResults, keywordResults } = await this.retrieveCandidates(query, {
      ...options,
      tracer,
      topK: childTopK,
    });
    const parentAggregateStart = Date.now();
    const parents = await this.aggregateParentCandidates(candidates, {
      limit: parentTopK,
      includeChildren,
    });
    this._recordTraceStage(tracer, 'parent_aggregate', parentAggregateStart, true, {
      childCount: candidates.length,
      parentCount: parents.length,
    });

    const retrievalSummary = this._summarizeRetrievalTrace(trace);
    tracer.setRetrieval(retrievalSummary);
    const result = {
      query,
      category: options.category || null,
      childTopK,
      parentTopK: parentTopK || parents.length,
      children: candidates.map((chunk, index) => this._chunkToCandidate(chunk, index + 1)),
      parents,
      retrieval: retrievalSummary,
      trace,
      vectorResults,
      keywordResults,
    };

    return ownsTracer
      ? this._finishTrace(tracer, result, { usedRag: true, retrievedChunks: candidates.length, matchedDocs: parents.length })
      : { ...result, traceId: tracer.traceId, trace: tracer.toSummary() };
  }

  async aggregateParentCandidates(chunks, options = {}) {
    if (!chunks || chunks.length === 0) return [];

    const limit = parseInt(options.limit || 0, 10) || 0;
    const includeChildren = options.includeChildren !== false;
    const paraMap = new Map();

    chunks.forEach((chunk, index) => {
      const childRank = index + 1;
      const parentId = chunk.parentId || (chunk.docId + '_para_' + (chunk.parentIdx ?? 0));
      if (!parentId) return;

      const current = paraMap.get(parentId) || {
        parentId,
        bestChunk: chunk,
        chunks: [],
        parentText: chunk.parentText || '',
        docId: chunk.docId,
        parentIdx: chunk.parentIdx,
        firstChildRank: childRank,
      };

      current.chunks.push({ ...chunk, _childRank: childRank });
      current.firstChildRank = Math.min(current.firstChildRank, childRank);
      if ((chunk.score || 0) > (current.bestChunk.score || 0)) current.bestChunk = chunk;
      if ((chunk.parentText || '').length > current.parentText.length) {
        current.parentText = chunk.parentText;
      }
      paraMap.set(parentId, current);
    });

    const docCache = new Map();
    const sortedMatches = [...paraMap.values()]
      .sort((a, b) => {
        const scoreDiff = (b.bestChunk.score || 0) - (a.bestChunk.score || 0);
        return scoreDiff || a.firstChildRank - b.firstChildRank;
      });
    const limitedMatches = limit > 0 ? sortedMatches.slice(0, limit) : sortedMatches;
    const parents = [];

    for (const match of limitedMatches) {
      let doc = docCache.has(match.docId) ? docCache.get(match.docId) : null;
      if (!docCache.has(match.docId) && match.docId) {
        doc = await this.documentService.getDocument(match.docId);
        docCache.set(match.docId, doc || null);
      }

      parents.push(this._parentMatchToCandidate(match, doc, parents.length + 1, { includeChildren }));
    }

    return parents;
  }
  fuseRetrievalResults(vectorResults = [], keywordResults = [], limit = this.searchTopK, _query = null) {
    // RRF 融合：score = Σ 1/(k + rank)，只看通道内排名，免去跨通道权重校准
    const merged = new Map();
    const addResult = (item, channel, rank) => {
      const key = item.id || `${item.docId}:${item.chunkIndex}`;
      const existing = merged.get(key) || {
        ...item,
        score: 0,
        _vectorScore: 0,
        _keywordScore: 0,
        _rrfScore: 0,
        _retrievalChannels: [],
      };

      if (channel === 'vector') {
        existing._vectorScore = Math.max(existing._vectorScore || 0, this._normalizeScore(item.score));
        existing._vectorRank = rank;
      } else if (channel === 'keyword') {
        existing._keywordScore = Math.max(existing._keywordScore || 0, this._normalizeScore(item._keywordScore ?? item.score));
        existing._keywordRank = rank;
      }

      existing._rrfScore += 1 / (this.rrfK + rank);
      if (!existing._retrievalChannels.includes(channel)) existing._retrievalChannels.push(channel);
      merged.set(key, { ...existing, ...this._preferFilledFields(existing, item) });
    };

    vectorResults.forEach((item, index) => addResult(item, 'vector', index + 1));
    keywordResults.forEach((item, index) => addResult(item, 'keyword', index + 1));

    return [...merged.values()]
      .map(item => ({ ...item, score: item._rrfScore || 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async selectTopChunks(query, candidates) {
    if (!candidates || candidates.length === 0) return [];
    // 现在 rerank 在父段落级别做（见 _runRAGPipeline），子句只需返回足够多的候选用作父段落聚合
    // 取 top 50 子句足够覆盖知识库中所有相关父段落
    const limit = Math.min(candidates.length, 50);
    return candidates.slice(0, limit);
  }

  buildParentChildPrompt(query, context) {
    return ragPrompt.buildParentChildPrompt(query, context);
  }

  /**
   * 流程类问题识别：办理/申请/补办等结构化流程问题
   */
  isProcessQuestion(query) {
    return ragPrompt.isProcessQuestion(query);
  }

  /**
   * 流程类问题的结构化输出 prompt：强制 LLM 输出 JSON 步骤卡片
   */
  buildProcessPrompt(query, context) {
    return ragPrompt.buildProcessPrompt(query, context);
  }

  /**
   * 从 LLM 回复中解析流程卡片 JSON（容忍 markdown 代码块包裹 / 前后杂文本）
   */
  parseProcessCard(reply) {
    return ragPrompt.parseProcessCard(reply);
  }

  _extractQueryTerms(query) {
    const normalized = String(query || '').toLowerCase();
    const terms = new Set();

    const englishWords = normalized.match(/[a-z0-9]{2,}/g) || [];
    englishWords.forEach(word => terms.add(word));

    const chineseRuns = normalized.match(/[\u4e00-\u9fff]+/g) || [];
    for (const run of chineseRuns) {
      for (let size = 2; size <= 4; size++) {
        if (run.length < size) continue;
        for (let index = 0; index <= run.length - size; index++) {
          terms.add(run.slice(index, index + size));
        }
      }
      if (run.length <= 4) terms.add(run);
    }

    const numbers = normalized.match(/\d+/g) || [];
    numbers.forEach(number => terms.add(number));

    return [...terms];
  }

  async chat(message, history = [], options = {}) {
    const tracer = this._createTracer(message, options);
    const totalStart = Date.now();

    try {
      const result = await this.localSearchChat(message, history, { ...options, tracer });
      if (result) return this._finishTrace(tracer, result);
    } catch (err) {
      tracer.markFallback('rag_pipeline_error');
      this._recordTraceStage(tracer, 'rag_pipeline', Date.now(), false, {}, err);
      console.warn(`[RAG] 本地检索失败，降级到纯 LLM: ${err.message}`);
    }

    const aiStart = Date.now();
    try {
      const result = await this.aiService.getCompletion(message, history);
      const aiLatency = Date.now() - aiStart;
      metrics.recordLatency('ai', aiLatency);
      this._recordTraceStage(tracer, 'llm', aiStart, true, {
        model: config.ai.model || 'step-3.7-flash',
        isMock: !!result.isMock,
        outputChars: (result.content || '').length,
        usage: result.usage || null,
      });
      metrics.recordLatency('total', Date.now() - totalStart);
      metrics.recordRagQuery({ usedRag: false, usedParentChild: false });
      this._recordTraceStage(tracer, 'total', totalStart, true, { usedRag: false });

      return this._finishTrace(tracer, {
        reply: result.content,
        isMock: result.isMock,
        sources: [],
        context: '',
        model: config.ai.model || 'step-3.7-flash',
        usage: result.usage || null,
      }, { usedRag: false, usedParentChild: false });
    } catch (err) {
      this._recordTraceStage(tracer, 'llm', aiStart, false, { model: config.ai.model || 'step-3.7-flash' }, err);
      this._recordTraceStage(tracer, 'total', totalStart, false, { usedRag: false }, err);
      tracer.markError(err);
      tracer.finish({ usedRag: false, usedParentChild: false });
      throw err;
    }
  }

  async *chatStream(message, history = [], options = {}) {
    const tracer = this._createTracer(message, options);
    const totalStart = Date.now();

    // 事件收集器,用于在管道内 yield
    const events = [];
    const onEvent = (event) => events.push(event);

    const pipeline = await this._runRAGPipeline(message, history, { ...options, tracer, onEvent });

    // 先 yield 管道中收集的事件
    for (const event of events) {
      if (event.type === 'retrieval') {
        yield { type: 'retrieval', ...event, traceId: tracer.traceId, trace: tracer.toSummary() };
      } else if (event.type === 'no_reliable_sources') {
        tracer.markFallback('no_reliable_sources');
        tracer.finish({ usedRag: true, usedParentChild: false, matchedDocs: 0, retrievedChunks: 0 });
        yield { type: 'trace', trace: tracer.toSummary() };
        yield { type: 'content', content: event.reply, done: false };
        yield { type: 'content', content: '', done: true };
        return;
      } else if (event.type === 'sources') {
        metrics.recordRagQuery({
          usedRag: true,
          usedParentChild: !!pipeline.context,
          matchedDocs: pipeline.sources.length,
          retrievedChunks: pipeline.topChunks.length,
        });
        yield event;
      }
    }

    // 没有可靠来源或上下文为空,返回兜底回复
    if (!pipeline.hasReliableCandidates || !pipeline.context) {
      const fallbackReason = !pipeline.hasReliableCandidates ? 'no_reliable_sources' : 'empty_enhanced_context';
      tracer?.markFallback(fallbackReason);
      this._recordTraceStage(tracer, 'total', totalStart, true, {
        usedRag: true,
        matchedDocs: pipeline.sources.length,
        retrievedChunks: pipeline.topChunks.length,
      });
      tracer?.finish({
        usedRag: true,
        usedParentChild: !!pipeline.context,
        matchedDocs: pipeline.sources.length,
        retrievedChunks: pipeline.topChunks.length,
        questionType: pipeline.questionType,
        rewrittenQuery: pipeline.rewrittenQuery,
      });
      yield { type: 'trace', trace: tracer.toSummary() };
      yield { type: 'content', content: this._buildNoReliableSourcesReply(), done: false };
      yield { type: 'content', content: '', done: true };
      return;
    }

    // 流式生成
    const aiStart = Date.now();
    const isProcess = this.isProcessQuestion(message);
    const enhancedPrompt = isProcess
      ? this.buildProcessPrompt(message, pipeline.context)
      : this.buildParentChildPrompt(message, pipeline.context);
    let outputChars = 0;
    let fullReply = '';

    try {
      for await (const chunk of this.aiService.getCompletionStream(enhancedPrompt, history, { signal: options.signal })) {
        if (chunk.done) {
          metrics.recordLatency('ai', Date.now() - aiStart);
          this._recordTraceStage(tracer, 'llm', aiStart, true, {
            model: config.ai.model || 'step-3.7-flash',
            stream: true,
            outputChars,
          });

          // 流程类问题：解析步骤卡片并下发给前端
          let processCard = null;
          if (isProcess) processCard = this.parseProcessCard(fullReply);
          if (processCard) {
            yield { type: 'process', processCard };
          }

          metrics.recordLatency('total', Date.now() - totalStart);
          this._recordTraceStage(tracer, 'total', totalStart, true, {
            usedRag: true,
            matchedDocs: pipeline.sources.length,
            retrievedChunks: pipeline.topChunks.length,
          });
          tracer.finish({
            usedRag: true,
            usedParentChild: true,
            matchedDocs: pipeline.sources.length,
            retrievedChunks: pipeline.topChunks.length,
            questionType: pipeline.questionType,
            rewrittenQuery: pipeline.rewrittenQuery,
          });
          yield { type: 'trace', trace: tracer.toSummary() };
          yield { type: 'content', content: '', done: true };
          return;
        }
        outputChars += (chunk.content || '').length;
        fullReply += chunk.content || '';
        yield { type: 'content', content: chunk.content, done: false };
      }
    } catch (err) {
      tracer?.markFallback('rag_pipeline_error');
      this._recordTraceStage(tracer, 'llm', aiStart, false, { model: config.ai.model || 'step-3.7-flash' }, err);
      console.warn(`[RAG] 流式检索失败，降级: ${err.message}`);
    }

    // 流式生成失败时降级:纯 LLM 无 RAG 上下文
    const aiStart2 = Date.now();
    let fallbackOutputChars = 0;
    try {
      for await (const chunk of this.aiService.getCompletionStream(message, history, { signal: options.signal })) {
        if (chunk.done) {
          metrics.recordLatency('ai', Date.now() - aiStart2);
          this._recordTraceStage(tracer, 'llm', aiStart2, true, {
            model: config.ai.model || 'step-3.7-flash',
            stream: true,
            outputChars: fallbackOutputChars,
          });
          metrics.recordLatency('total', Date.now() - totalStart);
          metrics.recordRagQuery({ usedRag: false, usedParentChild: false });
          this._recordTraceStage(tracer, 'total', totalStart, true, { usedRag: false });
          tracer.finish({ usedRag: false, usedParentChild: false });
          yield { type: 'trace', trace: tracer.toSummary() };
          yield { type: 'content', content: '', done: true };
          return;
        }
        fallbackOutputChars += (chunk.content || '').length;
        yield { type: 'content', content: chunk.content, done: false };
      }
    } catch (err) {
      this._recordTraceStage(tracer, 'llm', aiStart2, false, { model: config.ai.model || 'step-3.7-flash', stream: true }, err);
      this._recordTraceStage(tracer, 'total', totalStart, false, { usedRag: false }, err);
      tracer.markError(err);
      tracer.finish({ usedRag: false, usedParentChild: false });
      throw err;
    }
  }
  _hasReliableCandidates(candidates) {
    return resultMapper.hasReliableCandidates(candidates, this.minSourceScore);
  }

  _buildParentSource(doc, match) {
    return resultMapper.buildParentSource(doc, match);
  }

  _parentMatchToCandidate(match, doc, rank, options = {}) {
    return resultMapper.parentMatchToCandidate(match, doc, rank, options);
  }

  _chunkToCandidate(chunk, rank) {
    return resultMapper.chunkToCandidate(chunk, rank);
  }

  _chunkToSource(chunk) {
    return resultMapper.chunkToSource(chunk);
  }

  _summarizeRetrievalTrace(trace) {
    return resultMapper.summarizeRetrievalTrace(trace, { enabled: this.rerankEnabled, topK: this.rerankTopK });
  }

  /**
   * 将子句列表按父段落分组（保留原始数据供 reranker 使用）
   */

  // ──────────────────────────────────────────────
  // 问题类型分类 + 差异化阈值
  // 按问题类型调整 minScore / rerankTopK，不用额外 LLM 调用，零延迟
  // ──────────────────────────────────────────────

  /** 问题类型枚举 */
  static QuestionType = QUESTION_TYPE;

  /** 按问题类型的阈值配置 */
  static TYPE_CONFIG = TYPE_CONFIG;

  /** 文档类别关键词表：用于元数据过滤（Multi-faceted Filtering）的 query → category 自动推断 */
  static DOC_CATEGORY_KEYWORDS = DOC_CATEGORY_KEYWORDS;

  /**
   * 根据问题文本分类
   * @param {string} query
   * @returns {string} 类型 key
   */
  classifyQuestion(query) {
    return classifyQuestion(query);
  }

  /**
   * 获取问题类型对应的阈值配置
   * @param {string} query
   * @returns {{ minScore: number, rerankTopK: number, needSource: boolean, clamp: [number, number] }}
   */
  getTypeConfig(query) {
    return getTypeConfig(query);
  }

  /**
   * 自动推断问题所属文档类别（Multi-faceted Filtering）。
   *
   * 规则：命中 ≥ 2 个类别关键词（或问题中直接出现类别名）才返回类别；
   * 低置信度返回 null（不设过滤，保持全库召回，避免误伤跨文档问题）。
   * 纯正则/子串实现，零 LLM、零额外耗时。
   *
   * @param {string} query
   * @returns {string|null} 推断出的文档类别，低置信返回 null
   */
  _inferDocCategory(query) {
    return inferDocCategory(query, this.autoCategoryFilter);
  }

  // ──────────────────────────────────────────────
  // Query 改写：解决多轮对话中指代/省略问题
  // 改写后双路检索（改写+原文），合并去重，reranker 统一排序
  // ──────────────────────────────────────────────

  /** 检测是否需要改写：有历史 + 含代词/省略 */
  shouldRewriteQuery(query, history) {
    if (!history || history.length === 0) return false;
    const lastUserMsg = history.filter(h => h.role === 'user').slice(-1)[0];
    if (!lastUserMsg) return false;

    const q = String(query || '').trim();
    // 短 query（< 5 字）大概率是省略
    if (q.length < 5) return true;
    // 含代词/指代
    if (/^(这个|那个|它|它们|他|她|他们|她们|那|那些|这些|这|那|其|该|此)/.test(q)) return true;
    if (/\b(这个|那个|它|它们|他|她|他们|她们|那|那些|这些)\b/.test(q)) return true;
    // 省略式（"那费用呢？""条件呢？"）
    if (/^(那|那.*呢|然后|还有|那.*吗|费用|条件|流程|要求|时间|地点|原因|结果|影响|区别|结果)$/.test(q)) return true;
    if (/^.+呢$/.test(q) && q.length < 8) return true;
    return false;
  }

  /**
   * 用 LLM 改写 query
   * 将带指代/省略的问题补全为独立的自包含问题
   * 处理三个核心难点：
   *   1. 实体消歧：多个候选实体时正确选择
   *   2. 跨轮指代：支持 3 轮内的长跨度指代
   *   3. 语义指代："这个"可能指整句话的意思而非单个名词
   * @returns {string|null} 改写后的 query，失败返回 null
   */
  async rewriteQuery(query, history) {
    if (!history || history.length === 0) return null;

    // 缓存拦截：同 query + 最近 6 条历史窗口时直接返回
    if (config.rag.cacheEnabled) {
      const historyHash = this._hashHistory(history.slice(-6));
      const cacheKey = `${String(query || '').trim().toLowerCase()}|${historyHash}`;
      const cached = rewriteCache.get(cacheKey);
      if (cached !== undefined) return cached;
    }

    // 取最近 3 轮（6 条消息），在 token 成本和跨度覆盖之间折中
    // 3 轮覆盖绝大多数指代场景，超过 3 轮的指代即使人工也难判断
    const recentHistory = history.slice(-6);
    const historyText = recentHistory
      .map(h => `${h.role === 'user' ? '用户' : '助手'}: ${h.content}`)
      .join('\n');

    const prompt = `根据对话历史，将用户最新问题补全为独立的自包含问题。

注意：
1. 如果"这个""那个""它"可能指代多个事物，根据上下文选出最可能的一个
2. 如果"这个"指代前文一整句话的意思，把整句话的要义概括进问题
3. 只输出补全后的问题，不要多余文字
4. 不要添加历史中没有的信息

对话历史：
${historyText}

用户最新问题：${query}

补全后的问题：`;

    try {
      const result = await this.aiService.getCompletion(prompt, [], { timeout: 5000, retries: 1 });
      const rewritten = (result.content || '').trim().replace(/^["「『]|["」』]$/g, '');
      if (!rewritten || rewritten.length < 2) return null;
      // 防止改写后和原文一模一样（LLM 偷懒）
      if (rewritten === query.trim()) return null;

      // 缓存写入
      if (config.rag.cacheEnabled) {
        const historyHash = this._hashHistory(recentHistory);
        const cacheKey = `${String(query || '').trim().toLowerCase()}|${historyHash}`;
        rewriteCache.set(cacheKey, rewritten);
      }

      console.log(`[QueryRewrite] "${query}" → "${rewritten}"`);
      return rewritten;
    } catch (err) {
      console.warn(`[QueryRewrite] 改写失败: ${err.message}`);
      return null;
    }
  }

  /** 将消息列表 hash 为短字符串，用于 rewrite 缓存 key */
  _hashHistory(messages) {
    if (!messages || !messages.length) return 'empty';
    return messages.map(m => `${m.role}:${(m.content || '').slice(0, 100)}`).join('|');
  }

  /**
   * 双路检索：改写 query + 原文 query 分别检索，合并去重
   * 改写失败时降级为单路
   * @returns {{ candidates: Array, trace: object, rewrittenQuery: string|null }}
   */
  async _dualRetrieve(message, history, options = {}) {
    const tracer = options.tracer || null;
    let rewrittenQuery = null;
    if (this.shouldRewriteQuery(message, history)) {
      const rewriteStart = Date.now();
      try {
        rewrittenQuery = await this.rewriteQuery(message, history);
        this._recordTraceStage(tracer, 'query_rewrite', rewriteStart, true, {
          changed: !!rewrittenQuery,
        });
      } catch (err) {
        this._recordTraceStage(tracer, 'query_rewrite', rewriteStart, false, {}, err);
      }
    }

    // 单路：不需要改写或改写失败
    if (!rewrittenQuery) {
      const { candidates, trace } = await this.retrieveCandidates(message, { ...options, queryVariant: 'original' });
      return { candidates, trace, rewrittenQuery: null };
    }

    // 双路：改写 + 原文分别检索，合并去重
    const [originalResult, rewrittenResult] = await Promise.all([
      this.retrieveCandidates(message, { ...options, queryVariant: 'original' }),
      this.retrieveCandidates(rewrittenQuery, { ...options, queryVariant: 'rewritten' }),
    ]);

    // 改写结果异常检测：如果改写后的检索结果显著少于原文（比例 < 0.3），
    // 说明改写可能偏了，此时以原文结果为主，仅补充改写结果中不重叠的高分项
    const rewriteRatio = rewrittenResult.candidates.length / Math.max(originalResult.candidates.length, 1);
    if (rewriteRatio < 0.3 && originalResult.candidates.length > 3) {
      console.log(`[QueryRewrite] 改写结果异常（改写${rewrittenResult.candidates.length}条 vs 原文${originalResult.candidates.length}条），降级为原文为主`);
    }

    // 合并去重：按 chunk id 去重，保留高分
    const merged = new Map();
    for (const c of originalResult.candidates) {
      const key = c.id || `${c.docId}:${c.chunkIndex}`;
      merged.set(key, c);
    }
    for (const c of rewrittenResult.candidates) {
      const key = c.id || `${c.docId}:${c.chunkIndex}`;
      const existing = merged.get(key);
      if (!existing || (c.score || 0) > (existing.score || 0)) {
        merged.set(key, c);
      }
    }

    const mergedCandidates = [...merged.values()]
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, this.searchTopK);

    // 合并 trace（取原始 query 的 trace，增加改写标记）
    const trace = originalResult.trace;
    trace.queryRewrite = {
      original: message,
      rewritten: rewrittenQuery,
      originalCount: originalResult.candidates.length,
      rewrittenCount: rewrittenResult.candidates.length,
      mergedCount: mergedCandidates.length,
    };

    console.log(`[QueryRewrite] 双路检索: 原文${originalResult.candidates.length}条 + 改写${rewrittenResult.candidates.length}条 → 合并${mergedCandidates.length}条`);
    return { candidates: mergedCandidates, trace, rewrittenQuery };
  }

  /**
   * 提取请求级阈值覆盖（A/B 评测/调参用）
   * 仅当请求显式传入有限数值时才覆盖，否则用默认配置（正常用户请求不受影响）
   * @param {Object} options - chat/chatStream 的 options
   * @returns {Object} { rerankMinScore?, rerankDropoff?, rerankTopK?, maxContextLength? }
   */
  _evalOverrides(options = {}) {
    const overrides = {};
    const finite = (v) => Number.isFinite(v);
    const minScore = Number(options.rerankMinScore);
    const dropoff = Number(options.rerankDropoff);
    const topK = Number(options.rerankTopK);
    const maxLen = Number(options.maxContextLength);
    if (finite(minScore) && minScore >= 0 && minScore <= 1) overrides.rerankMinScore = minScore;
    if (finite(dropoff) && dropoff >= 0 && dropoff <= 1) overrides.rerankDropoff = dropoff;
    if (finite(topK) && topK >= 1 && topK <= 100) overrides.rerankTopK = Math.round(topK);
    if (finite(maxLen) && maxLen >= 500 && maxLen <= 20000) overrides.maxContextLength = Math.round(maxLen);
    return overrides;
  }

  /**
   * 自适应截断：保留高置信度父段，剔除低分和断崖段落
   * 策略：基础 Top N → 断崖检测 → 低分过滤 → 硬上限
   * @param {Array} candidates - 父段落候选列表
   * @param {number} maxCount - 硬上限
   * @param {string} [query] - 问题原文，用于获取类型化阈值
   * @param {Object} [overrides] - 请求级覆盖 { rerankMinScore, rerankDropoff, rerankTopK }
   * @returns {Array} 截断后的候选列表
   */
  _adaptiveTruncate(candidates, maxCount, query, overrides = {}) {
    return adaptiveTruncate(candidates, maxCount, query, overrides, (value) => this.getTypeConfig(value));
  }

  /**
   * 字符 bigram 集合：中文文本相似度的轻量特征（零模型调用）
   */
  _charBigrams(text) {
    return charBigrams(text);
  }

  /**
   * 字符 bigram Jaccard 相似度（0~1）
   */
  _jaccardBigrams(setA, setB) {
    return jaccardBigrams(setA, setB);
  }

  /**
   * 父段归并后 MMR 去重：剔除与已选父段高度相似的冗余段落。
   *
   * 思路（对标 RAG_Techniques 的 reranking 多样性）：
   *   1. 按相关性（rerank/检索分数）降序贪心选择第一个父段
   *   2. 后续每次选择使 score = λ·relevance − (1−λ)·maxSim(selected) 最大的父段
   *   3. 与已选父段相似度 ≥ mmrMaxSim 的段落直接视为冗余剔除
   *
   * 相似度用字符 bigram Jaccard 计算，无 embedding / 无模型调用，开销可忽略。
   *
   * @param {Array} parentCandidates 父段候选（需含 parentText 或 bestChunk.text、_rerankScore 或 bestChunk.score）
   * @param {number} [maxCount] 去重后最多保留数量，默认全部候选
   * @returns {Array} 去重后的父段候选
   */
  _mmrDedupe(parentCandidates, maxCount = 0) {
    return mmrDedupe(parentCandidates, maxCount, {
      enabled: this.mmrEnabled,
      lambda: this.mmrLambda,
      maxSimilarity: this.mmrMaxSim,
    });
  }

  _groupChunksByParent(chunks) {
    const paraMap = new Map();
    for (const chunk of chunks) {
      const key = chunk.parentId || (chunk.docId + '_para_' + (chunk.parentIdx ?? 0));
      if (!key) continue;
      const current = paraMap.get(key) || {
        parentId: key,
        bestChunk: chunk,
        chunks: [],
        parentText: chunk.parentText || '',
        docId: chunk.docId,
        parentIdx: chunk.parentIdx,
        firstChildRank: 0,
      };
      current.chunks.push(chunk);
      current.firstChildRank = current.firstChildRank || chunks.indexOf(chunk) + 1;
      if ((chunk.score || 0) > (current.bestChunk.score || 0)) current.bestChunk = chunk;
      if ((chunk.parentText || '').length > current.parentText.length) {
        current.parentText = chunk.parentText;
      }
      paraMap.set(key, current);
    }
    return paraMap;
  }

  /**
   * 从已 rerank 的父段落聚合结果构建上下文
   */
  async _buildContextFromParents(parentCandidates, overrides = {}) {
    if (!parentCandidates || parentCandidates.length === 0) {
      return { sources: [], context: '' };
    }
    // 按 rerank 分数排序（rerank 已对所有父段打分，取高分优先）
    parentCandidates.sort((a, b) => (b._rerankScore || b.bestChunk?.score || 0) - (a._rerankScore || a.bestChunk?.score || 0));
    const selected = parentCandidates;

    // 上下文长度支持请求级覆盖（A/B 评测验证"少而精"）
    const maxContextLength = overrides.maxContextLength ?? this.maxContextLength;

    const contextParts = [];
    const sources = [];
    let totalLength = 0;
    let docIndex = 0;
    const docCache = new Map();

    for (const match of selected) {
      const docId = match.docId;
      if (!docId) continue;

      let doc = docCache.get(docId);
      if (!doc) {
        doc = await this.documentService.getDocument(docId);
        if (!doc) continue;
        docCache.set(docId, doc);
      }

      const paraText = match.parentText || match.bestChunk?.text || match.bestChunk?.parentText || '';
      if (!paraText) continue;
      docIndex++;

      const header = `【文档 ${docIndex}】${doc.title}（段落 ${(match.parentIdx ?? 0) + 1}）`;
      const entry = `${header}\n${paraText}`;
      const rerankScore = match._rerankScore || match.bestChunk?.score || 0;

      if (totalLength + entry.length > maxContextLength) {
        const remaining = maxContextLength - totalLength;
        if (remaining > 200) {
          contextParts.push(entry.substring(0, remaining) + '\n...(截断)');
          sources.push({
            id: doc.id, title: doc.title, category: doc.category,
            matchedScore: rerankScore, rerankScore, rerankModel: match._rerankModel || '',
            snippet: paraText.substring(0, 1500),
          });
        }
        break;
      }

      contextParts.push(entry);
      totalLength += entry.length;
      sources.push({
        id: doc.id, title: doc.title, category: doc.category,
        matchedScore: rerankScore, rerankScore, rerankModel: match._rerankModel || '',
        snippet: paraText.substring(0, 1500),
      });
    }

    const context = contextParts.join('\n\n' + '='.repeat(40) + '\n\n');
    return { sources, context };
  }

  _preferFilledFields(existing, incoming) {
    return resultMapper.preferFilledFields(existing, incoming);
  }

  _normalizeScore(score) {
    return resultMapper.normalizeScore(score);
  }

  _buildNoReliableSourcesReply() {
    return ragPrompt.buildNoReliableSourcesReply();
  }
}

module.exports = { RagService, metrics };













