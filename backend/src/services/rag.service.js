"use strict";

const { AiService } = require('./ai.service');
const { DocumentService } = require('./document.service');
const { EmbeddingService } = require('./embedding.service');
const { vectorStore: vectorStoreSingleton } = require('./vector-store.service');
const { RerankerService } = require('./reranker.service');
const config = require('../config');
const { metrics } = require('./metrics.service');
const { RagTracer } = require('./rag-tracer.service');

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
    if (/milvus|vector|collection/.test(message)) return 'vector_store';
    if (/embedding|transformer|model/.test(message)) return 'embedding';
    if (/network|econn|enotfound|socket|fetch/.test(message)) return 'network';
    return 'unknown';
  }

  /**
   * 本地混合检索管道
   * query → embedding 向量召回 + BM25 关键词召回 → RRF 融合 → rerank → 父文档召回 → LLM 增强
   */
  async localSearchChat(message, history = [], options = {}) {
    const tracer = this._createTracer(message, options);
    const ownsTracer = !options.tracer;
    const totalStart = Date.now();
    const questionType = this.classifyQuestion(message);

    const docsStart = Date.now();
    const docs = await this.documentService.listDocuments({ category: options.category, limit: 1 });
    this._recordTraceStage(tracer, 'document_check', docsStart, true, {
      docCount: docs.documents.length,
      category: options.category || null,
    });
    if (docs.documents.length === 0) {
      tracer.markFallback('no_documents');
      if (ownsTracer) tracer.finish({ usedRag: false, fallbackReason: 'no_documents' });
      return null;
    }

    const { candidates, trace, rewrittenQuery } = await this._dualRetrieve(message, history, { ...options, tracer });

    if (!this._hasReliableCandidates(candidates)) {
      metrics.recordRagQuery({ usedRag: true, usedParentChild: false, matchedDocs: 0, retrievedChunks: 0 });
      const retrievalSummary = this._summarizeRetrievalTrace(trace);
      tracer.setRetrieval(retrievalSummary);
      tracer.markFallback('no_reliable_sources');
      this._recordTraceStage(tracer, 'total', totalStart, true, { usedRag: true, matchedDocs: 0, retrievedChunks: 0 });
      const result = {
        reply: this._buildNoReliableSourcesReply(),
        isMock: false,
        sources: [],
        context: '',
        model: 'local-hybrid-search+no-source',
        questionType,
        rewrittenQuery,
        retrieval: retrievalSummary,
        _metrics: {
          totalLatency: Date.now() - totalStart,
          matchedDocs: 0,
          retrievedChunks: 0,
          questionType,
          rewrittenQuery,
          retrieval: retrievalSummary,
        },
      };
      return ownsTracer ? this._finishTrace(tracer, result) : { ...result, traceId: tracer.traceId, trace: tracer.toSummary() };
    }

    const rerankStart = Date.now();
    const topChunks = await this.selectTopChunks(message, candidates);
    const childSelectLatency = Date.now() - rerankStart;
    metrics.recordLatency('rerank', childSelectLatency);
    this._recordTraceStage(tracer, 'child_select', rerankStart, true, {
      inputCount: candidates.length,
      outputCount: topChunks.length,
    });

    let enhancedContext = '';
    let parentSources = [];
    let parentChildLatency = 0;
    if (this.parentChildEnabled && topChunks.length > 0) {
      try {
        const pcStart = Date.now();
        // 1. 子句按父段落聚合
        const paraMap = this._groupChunksByParent(topChunks);
        let parentCandidates = [...paraMap.values()];

        // 2. cross-encoder rerank 父段落（先按 score 粗排取前 20，避免 CPU ONNX 处理过多候选）
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

        // 3. 自适应截断（按问题类型差异化阈值）
        parentCandidates = this._adaptiveTruncate(parentCandidates, this.rerankTopK, message);

        // 3.5 父段归并后 MMR 去重：剔除与已选父段高度相似的冗余段落（保留多样性）
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

        // 4. 按 (docId, parentIdx) 二级排序，让同文档连续段落按阅读顺序排列
        parentCandidates.sort((a, b) => {
          const docCmp = (a.docId || '').localeCompare(b.docId || '');
          if (docCmp !== 0) return docCmp;
          return (a.parentIdx ?? 0) - (b.parentIdx ?? 0);
        });

        // 5. 组装上下文（由 maxContextLength 控制长度）
        const { context, sources } = await this._buildContextFromParents(parentCandidates);
        enhancedContext = context;
        parentSources = sources;
        parentChildLatency = Date.now() - pcStart;
        metrics.recordLatency('parentChild', parentChildLatency);
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

    let reply = '';
    let aiLatency = 0;
    let processCard = null;
    if (enhancedContext) {
      const aiStart = Date.now();
      try {
        const isProcess = this.isProcessQuestion(message);
        const enhancedPrompt = isProcess
          ? this.buildProcessPrompt(message, enhancedContext)
          : this.buildParentChildPrompt(message, enhancedContext);
        const llmResult = await this.aiService.getCompletion(enhancedPrompt, history);
        aiLatency = Date.now() - aiStart;
        this._recordTraceStage(tracer, 'llm', aiStart, true, {
          model: config.ai.model || 'step-3.7-flash',
          isMock: !!llmResult.isMock,
          outputChars: (llmResult.content || '').length,
          usage: llmResult.usage || null,
        });
        reply = llmResult.content;
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
    const retrievalSummary = this._summarizeRetrievalTrace(trace);
    metrics.recordLatency('total', totalLatency);
    metrics.recordRagQuery({
      usedRag: true,
      usedParentChild: !!enhancedContext,
      matchedDocs: parentSources.length,
      retrievedChunks: topChunks.length,
    });

    tracer.setRetrieval(retrievalSummary);
    tracer.setOutcome({
      usedRag: true,
      usedParentChild: !!enhancedContext,
      matchedDocs: parentSources.length,
      retrievedChunks: topChunks.length,
      questionType,
      rewrittenQuery,
    });
    this._recordTraceStage(tracer, 'total', totalStart, true, {
      usedRag: true,
      matchedDocs: parentSources.length,
      retrievedChunks: topChunks.length,
    });

    const result = {
      reply,
      isMock: false,
      sources: parentSources.length > 0
        ? parentSources
        : topChunks.slice(0, this.rerankTopK).map(c => this._chunkToSource(c)),
      context: enhancedContext,
      model: 'local-hybrid-search+parent-child',
      questionType,
      rewrittenQuery,
      retrieval: retrievalSummary,
      processCard: processCard || null,
      _metrics: {
        totalLatency,
        parentChildLatency,
        aiLatency,
        matchedDocs: parentSources.length,
        retrievedChunks: topChunks.length,
        questionType,
        rewrittenQuery,
        retrieval: retrievalSummary,
      },
    };
    return ownsTracer ? this._finishTrace(tracer, result) : { ...result, traceId: tracer.traceId, trace: tracer.toSummary() };
  }

  async retrieveCandidates(query, options = {}) {
    const searchTopK = parseInt(options.topK || options.childTopK || this.searchTopK, 10) || this.searchTopK;
    const tracer = options.tracer || null;
    const queryVariant = options.queryVariant || 'primary';

    // 元数据过滤（Multi-faceted Filtering）：显式 category 优先；
    // 未指定时按问题关键词自动推断（低置信返回 null → 不设过滤，保持全库召回）
    const explicitCategory = options.category || null;
    const autoCategory = !explicitCategory ? this._inferDocCategory(query) : null;
    const effectiveCategory = explicitCategory || autoCategory || null;

    const trace = {
      mode: 'bge-small-zh-milvus-hybrid',
      category: effectiveCategory,
      autoCategory,
      topK: {
        hybrid: searchTopK,
        final: searchTopK,
      },
      embedding: { ok: false, dense: false, sparse: false, latency: 0, model: null },
      vector: { count: 0, latency: 0, error: null, backend: 'milvus_hybrid' },
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
        currentStage = 'milvus_search';
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
          backend: 'milvus_hybrid',
        };
        metrics.recordLatency('vectorSearch', trace.vector.latency);
        this._recordTraceStage(tracer, 'milvus_search', searchStart, true, {
          queryVariant,
          topK: searchTopK,
          count: candidates.length,
          category: effectiveCategory || null,
          autoCategory,
          backend: trace.vector.backend,
        });
      } else {
        this._recordTraceStage(tracer, 'milvus_search', Date.now(), false, {
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
      console.warn(`[RAG] BGE-small-zh + Milvus 混合召回失败: ${err.message}`);
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
  fuseRetrievalResults(vectorResults = [], keywordResults = [], limit = this.searchTopK, query = null) {
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
    // 现在 rerank 在父段落级别做（见 localSearchChat），子句只需返回足够多的候选用作父段落聚合
    // 取 top 50 子句足够覆盖知识库中所有相关父段落
    const limit = Math.min(candidates.length, 50);
    return candidates.slice(0, limit);
  }

  /**
   * 父子段落召回：子级句子负责向量命中，父级段落负责给 LLM 提供上下文
   *
   * 架构：
   *   文档 → 段落（父级）→ 句子（子级，向量化存入 Milvus）
   *   检索命中句子 → 按 parentIdx 去重 → 取父段落文本作为上下文
   *
   * 优先注入命中的父段落；旧索引没有 parentText 时才回退到 chunk/doc 内容。
   */
  async assembleParentContext(chunks) {
    if (!chunks || chunks.length === 0) {
      return { sources: [], context: '', parentDocs: [] };
    }

    // 按 parentIdx（段落索引）分组，多个句子命中同一段落只取一次
    const paraMap = new Map();
    for (const chunk of chunks) {
      const key = chunk.parentId || (chunk.docId + '_para_' + (chunk.parentIdx ?? 0));
      if (!key) continue;
      const current = paraMap.get(key) || {
        bestChunk: chunk,
        chunks: [],
        parentText: chunk.parentText || '',
        docId: chunk.docId,
        parentIdx: chunk.parentIdx,
      };
      current.chunks.push(chunk);
      if ((chunk.score || 0) > (current.bestChunk.score || 0)) current.bestChunk = chunk;
      // 优先用最完整的 parentText
      if ((chunk.parentText || '').length > current.parentText.length) {
        current.parentText = chunk.parentText;
      }
      paraMap.set(key, current);
    }

    const contextParts = [];
    const sources = [];
    const parentDocs = [];
    let totalLength = 0;
    let docIndex = 0;

    // 父段归并后 MMR 去重：剔除与已选父段高度相似的冗余段落（保留多样性）
    const parentMatches = this._mmrDedupe([...paraMap.values()]);
    const sortedMatches = parentMatches
      .sort((a, b) => (b.bestChunk.score || 0) - (a.bestChunk.score || 0));

    for (const match of sortedMatches) {
      const docId = match.docId;
      if (!docId) continue;

      const doc = await this.documentService.getDocument(docId);
      if (!doc) continue;

      const paraText = match.parentText || match.bestChunk.text || doc.content || '';
      if (!paraText) continue;
      docIndex++;

      const header = `【文档 ${docIndex}】${doc.title}（段落 ${match.parentIdx + 1}）`;
      const entry = `${header}\n${paraText}`;

      if (totalLength + entry.length > this.maxContextLength) {
        const remaining = this.maxContextLength - totalLength;
        if (remaining > 200) {
          contextParts.push(entry.substring(0, remaining) + '\n...(内容过长已截断)');
          parentDocs.push(doc);
          sources.push(this._buildParentSource(doc, match));
        }
        break;
      }

      contextParts.push(entry);
      totalLength += entry.length;
      parentDocs.push(doc);
      sources.push(this._buildParentSource(doc, match));
    }

    const context = contextParts.join('\n\n' + '='.repeat(40) + '\n\n');
    return { sources, context, parentDocs };
  }

  buildParentChildPrompt(query, context) {
    if (!context) return query;

    return `你是武汉理工大学校园知识助手。请严格根据“参考资料”回答用户问题。

要求：
1. 回答要详细、完整、具体：把资料中的关键信息（时间、地点、条件、流程、数量、联系方式等）都展开说明，分点或分条组织，不要只给一句话结论。
2. 优先使用参考资料，不要编造资料中没有的信息；资料不足时明确说明缺什么，并建议用户补充资料或换一种问法。
3. 回答关键事实时引用文档编号，例如“根据【文档 1】”。
4. 如果不同文档存在冲突，优先说明冲突点，不要自行合并成确定结论。
5. 输出用 Markdown 排版：列表用 "-" 或 "1."，重要信息加粗，方便阅读。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
参考资料：
${context}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户问题：${query}`;
  }

  /**
   * 流程类问题识别：办理/申请/补办等结构化流程问题
   */
  isProcessQuestion(query) {
    return /补办|办理|申请|报名|流程|步骤|手续|怎么办|如何办理|怎么做|需要什么材料|材料|多久|多长时间|在哪办|哪里办|费用是多少/.test(String(query || ''));
  }

  /**
   * 流程类问题的结构化输出 prompt：强制 LLM 输出 JSON 步骤卡片
   */
  buildProcessPrompt(query, context) {
    if (!context) return query;

    return `你是武汉理工大学校园知识助手。请严格根据“参考资料”回答用户问题，并且必须输出严格 JSON。

要求：
1. 只依据参考资料回答，不要编造资料中没有的信息；资料不足时对应字段填 null 或空数组。
2. 必须输出严格合法的 JSON 对象（不要用 markdown 代码块包裹，不要输出任何其他文字），结构如下：
{
  "summary": "一句话概述办理结果",
  "steps": [{"title": "步骤标题", "detail": "具体操作说明"}],
  "materials": ["所需材料1", "所需材料2"],
  "location": "办理地点，资料未提及则为 null",
  "duration": "办理时长/周期，资料未提及则为 null",
  "notes": "注意事项，资料未提及则为 null"
}
3. 步骤中的关键事实请标注文档引用，例如 detail 中写“根据【文档 1】”。
4. steps 至少 1 项；materials 无材料时为空数组。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
参考资料：
${context}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户问题：${query}`;
  }

  /**
   * 从 LLM 回复中解析流程卡片 JSON（容忍 markdown 代码块包裹 / 前后杂文本）
   */
  parseProcessCard(reply) {
    if (!reply || typeof reply !== 'string') return null;
    try {
      const text = String(reply).trim();
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const raw = fenced ? fenced[1] : text;
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) return null;
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (!parsed || typeof parsed !== 'object') return null;
      const card = {
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        steps: Array.isArray(parsed.steps)
          ? parsed.steps
            .filter((s) => s && (s.title || s.detail))
            .map((s) => ({ title: String(s.title || '').trim(), detail: String(s.detail || '').trim() }))
          : [],
        materials: Array.isArray(parsed.materials)
          ? parsed.materials.map((m) => String(m || '').trim()).filter(Boolean)
          : [],
        location: parsed.location ? String(parsed.location) : null,
        duration: parsed.duration ? String(parsed.duration) : null,
        notes: parsed.notes ? String(parsed.notes) : null,
      };
      // 至少要有一个有意义的字段才算有效卡片
      const hasContent = card.steps.length > 0 || card.materials.length > 0 || card.location || card.duration;
      return hasContent ? card : null;
    } catch {
      return null;
    }
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
    const docsStart = Date.now();
    const docs = await this.documentService.listDocuments({ category: options.category, limit: 1 });
    this._recordTraceStage(tracer, 'document_check', docsStart, true, {
      docCount: docs.documents.length,
      category: options.category || null,
    });

    if (docs.documents.length > 0) {
      try {
        const { candidates, trace, rewrittenQuery } = await this._dualRetrieve(message, history, { ...options, tracer });
        const questionType = this.classifyQuestion(message);
        const retrievalSummary = this._summarizeRetrievalTrace(trace);
        tracer.setRetrieval(retrievalSummary);
        yield { type: 'retrieval', retrieval: retrievalSummary, traceId: tracer.traceId, trace: tracer.toSummary(), questionType, rewrittenQuery };

        if (!this._hasReliableCandidates(candidates)) {
          metrics.recordRagQuery({ usedRag: true, usedParentChild: false, matchedDocs: 0, retrievedChunks: 0 });
          tracer.markFallback('no_reliable_sources');
          this._recordTraceStage(tracer, 'total', totalStart, true, { usedRag: true, matchedDocs: 0, retrievedChunks: 0 });
          tracer.finish({ usedRag: true, usedParentChild: false, matchedDocs: 0, retrievedChunks: 0 });
          yield { type: 'trace', trace: tracer.toSummary() };
          yield { type: 'content', content: this._buildNoReliableSourcesReply(), done: false };
          yield { type: 'content', content: '', done: true };
          return;
        }

        const childSelectStart = Date.now();
        const topChunks = await this.selectTopChunks(message, candidates);
        const childSelectLatency = Date.now() - childSelectStart;
        metrics.recordLatency('rerank', childSelectLatency);
        this._recordTraceStage(tracer, 'child_select', childSelectStart, true, {
          inputCount: candidates.length,
          outputCount: topChunks.length,
        });

        let enhancedContext = '';
        let parentSources = [];
        if (this.parentChildEnabled) {
          const pcStart = Date.now();
          try {
            const { context, sources } = await this.assembleParentContext(topChunks);
            enhancedContext = context;
            parentSources = sources;
            metrics.recordLatency('parentChild', Date.now() - pcStart);
            this._recordTraceStage(tracer, 'parent_child', pcStart, true, {
              inputChunks: topChunks.length,
              parentCount: parentSources.length,
              contextLength: enhancedContext.length,
            });
          } catch (err) {
            this._recordTraceStage(tracer, 'parent_child', pcStart, false, { inputChunks: topChunks.length }, err);
            console.warn(`[RAG] 父子召回失败: ${err.message}`);
          }
        }

        metrics.recordRagQuery({
          usedRag: true,
          usedParentChild: !!enhancedContext,
          matchedDocs: parentSources.length,
          retrievedChunks: topChunks.length,
        });

        if (parentSources.length > 0) {
          yield { type: 'sources', sources: parentSources };
        } else if (topChunks.length > 0) {
          yield { type: 'sources', sources: topChunks.map(chunk => this._chunkToSource(chunk)) };
        }

        if (enhancedContext) {
          const aiStart = Date.now();
          const isProcess = this.isProcessQuestion(message);
          const enhancedPrompt = isProcess
            ? this.buildProcessPrompt(message, enhancedContext)
            : this.buildParentChildPrompt(message, enhancedContext);
          let outputChars = 0;
          let fullReply = '';
          for await (const chunk of this.aiService.getCompletionStream(enhancedPrompt, history)) {
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
                matchedDocs: parentSources.length,
                retrievedChunks: topChunks.length,
              });
              tracer.finish({
                usedRag: true,
                usedParentChild: true,
                matchedDocs: parentSources.length,
                retrievedChunks: topChunks.length,
                questionType,
                rewrittenQuery,
              });
              yield { type: 'trace', trace: tracer.toSummary() };
              yield { type: 'content', content: '', done: true };
              return;
            }
            outputChars += (chunk.content || '').length;
            fullReply += chunk.content || '';
            yield { type: 'content', content: chunk.content, done: false };
          }
        } else {
          tracer.markFallback('empty_enhanced_context');
          this._recordTraceStage(tracer, 'total', totalStart, true, {
            usedRag: true,
            matchedDocs: parentSources.length,
            retrievedChunks: topChunks.length,
          });
          tracer.finish({
            usedRag: true,
            usedParentChild: false,
            matchedDocs: parentSources.length,
            retrievedChunks: topChunks.length,
            questionType,
            rewrittenQuery,
          });
          yield { type: 'trace', trace: tracer.toSummary() };
          yield { type: 'content', content: this._buildNoReliableSourcesReply(), done: false };
          yield { type: 'content', content: '', done: true };
          return;
        }
      } catch (err) {
        tracer.markFallback('rag_pipeline_error');
        this._recordTraceStage(tracer, 'rag_pipeline', Date.now(), false, {}, err);
        console.warn(`[RAG] 流式检索失败，降级: ${err.message}`);
      }
    }

    const aiStart = Date.now();
    let outputChars = 0;
    try {
      for await (const chunk of this.aiService.getCompletionStream(message, history)) {
        if (chunk.done) {
          metrics.recordLatency('ai', Date.now() - aiStart);
          this._recordTraceStage(tracer, 'llm', aiStart, true, {
            model: config.ai.model || 'step-3.7-flash',
            stream: true,
            outputChars,
          });
          metrics.recordLatency('total', Date.now() - totalStart);
          metrics.recordRagQuery({ usedRag: false, usedParentChild: false });
          this._recordTraceStage(tracer, 'total', totalStart, true, { usedRag: false });
          tracer.finish({ usedRag: false, usedParentChild: false });
          yield { type: 'trace', trace: tracer.toSummary() };
          yield { type: 'content', content: '', done: true };
          return;
        }
        outputChars += (chunk.content || '').length;
        yield { type: 'content', content: chunk.content, done: false };
      }
    } catch (err) {
      this._recordTraceStage(tracer, 'llm', aiStart, false, { model: config.ai.model || 'step-3.7-flash', stream: true }, err);
      this._recordTraceStage(tracer, 'total', totalStart, false, { usedRag: false }, err);
      tracer.markError(err);
      tracer.finish({ usedRag: false, usedParentChild: false });
      throw err;
    }
  }
  _hasReliableCandidates(candidates) {
    return candidates.length > 0 && (candidates[0].score || 0) >= this.minSourceScore;
  }

  _buildParentSource(doc, match) {
    const chunkIndexes = [...new Set(match.chunks.map(chunk => chunk.chunkIndex).filter(index => index !== undefined))];
    const channels = [...new Set(match.chunks.flatMap(chunk => chunk._retrievalChannels || []))];
    const rerankScore = match.bestChunk._rerankScore || 0;
    return {
      id: doc.id,
      title: doc.title,
      category: doc.category,
      chunkCount: doc.chunkCount,
      matchedChunks: chunkIndexes.length || match.chunks.length,
      matchedChunkIds: chunkIndexes,
      snippet: (match.parentText || match.bestChunk?.text || '').substring(0, 1500),
      matchedScore: rerankScore || match.bestChunk.score || 0,
      vectorScore: match.bestChunk._vectorScore || 0,
      sparseScore: match.bestChunk._sparseScore || 0,
      hybridScore: match.bestChunk._hybridScore || match.bestChunk.score || 0,
      keywordScore: match.bestChunk._keywordScore || 0,
      rerankScore,
      rerankModel: match.bestChunk._rerankModel || '',
      retrievalChannels: channels,
    };
  }

  _parentMatchToCandidate(match, doc, rank, options = {}) {
    const includeChildren = options.includeChildren !== false;
    const chunkIndexes = [...new Set(match.chunks.map(chunk => chunk.chunkIndex).filter(index => index !== undefined))];
    const channels = [...new Set(match.chunks.flatMap(chunk => chunk._retrievalChannels || []))];
    const parentId = match.parentId || match.bestChunk.parentId || `${match.docId}_para_${match.parentIdx ?? 0}`;

    return {
      rank,
      id: parentId,
      parentId,
      docId: match.docId,
      title: doc?.title || match.bestChunk.title || '',
      category: doc?.category || match.bestChunk.category || '',
      parentIdx: match.parentIdx ?? match.bestChunk.parentIdx ?? -1,
      parentText: match.parentText || match.bestChunk.text || doc?.content || '',
      matchedChunks: chunkIndexes.length || match.chunks.length,
      matchedChunkIds: chunkIndexes,
      firstChildRank: match.firstChildRank,
      bestChildRank: match.bestChunk._childRank || match.firstChildRank,
      matchedScore: match.bestChunk.score || 0,
      vectorScore: match.bestChunk._vectorScore || 0,
      sparseScore: match.bestChunk._sparseScore || 0,
      hybridScore: match.bestChunk._hybridScore || match.bestChunk.score || 0,
      keywordScore: match.bestChunk._keywordScore || 0,
      retrievalChannels: channels,
      children: includeChildren
        ? match.chunks.map(chunk => this._chunkToCandidate(chunk, chunk._childRank)).sort((a, b) => a.rank - b.rank)
        : undefined,
    };
  }

  _chunkToCandidate(chunk, rank) {
    return {
      rank,
      id: chunk.id || `${chunk.docId}:${chunk.chunkIndex}`,
      docId: chunk.docId,
      parentId: chunk.parentId || `${chunk.docId}_para_${chunk.parentIdx ?? 0}`,
      parentIdx: chunk.parentIdx ?? -1,
      chunkIndex: chunk.chunkIndex ?? -1,
      title: chunk.title || '',
      category: chunk.category || '',
      text: chunk.text || '',
      score: chunk.score || 0,
      vectorScore: chunk._vectorScore || 0,
      sparseScore: chunk._sparseScore || 0,
      hybridScore: chunk._hybridScore || chunk.score || 0,
      keywordScore: chunk._keywordScore || 0,
      rerankScore: chunk._rerankScore || 0,
      rerankModel: chunk._rerankModel || '',
      retrievalChannels: chunk._retrievalChannels || [],
    };
  }

  _chunkToSource(chunk) {
    return {
      id: chunk.docId,
      title: chunk.title,
      category: chunk.category,
      chunkIndex: chunk.chunkIndex,
      matchedScore: chunk.score || 0,
      parentId: chunk.parentId || chunk.docId,
      vectorScore: chunk._vectorScore || 0,
      sparseScore: chunk._sparseScore || 0,
      hybridScore: chunk._hybridScore || chunk.score || 0,
      keywordScore: chunk._keywordScore || 0,
      rerankScore: chunk._rerankScore || 0,
      rerankModel: chunk._rerankModel || '',
      retrievalChannels: chunk._retrievalChannels || [],
    };
  }

  _summarizeRetrievalTrace(trace) {
    if (!trace) return null;
    return {
      mode: trace.mode,
      category: trace.category,
      topK: trace.topK,
      rerank: {
        enabled: this.rerankEnabled,
        topK: this.rerankTopK,
        model: 'bge-reranker-base',
      },
      embedding: trace.embedding,
      vector: trace.vector,
      keyword: trace.keyword,
      fused: trace.fused,
      queryRewrite: trace.queryRewrite || null,
    };
  }

  /**
   * 将子句列表按父段落分组（保留原始数据供 reranker 使用）
   */

  // ──────────────────────────────────────────────
  // 问题类型分类 + 差异化阈值
  // 按问题类型调整 minScore / rerankTopK，不用额外 LLM 调用，零延迟
  // ──────────────────────────────────────────────

  /** 问题类型枚举 */
  static QuestionType = {
    AUTHORITATIVE: 'authoritative',  // 教务政策：答错有后果，宁缺毋滥
    KNOWLEDGE:     'knowledge',      // 课件笔记：答偏了问题不大，宽容
    FACTUAL:       'factual',        // 具体事实：需要准确数字/名称
    GENERAL:       'general',        // 默认
  };

  /** 按问题类型的阈值配置 */
  static TYPE_CONFIG = {
    authoritative: { minScore: 0.50, rerankTopK: 6, needSource: true,  clamp: [0.35, 0.70] },
    knowledge:     { minScore: 0.25, rerankTopK: 6, needSource: false, clamp: [0.15, 0.40] },
    factual:       { minScore: 0.40, rerankTopK: 6, needSource: true,  clamp: [0.25, 0.55] },
    general:       { minScore: 0.30, rerankTopK: 6, needSource: false, clamp: [0.20, 0.50] },
  };

  /** 文档类别关键词表：用于元数据过滤（Multi-faceted Filtering）的 query → category 自动推断 */
  static DOC_CATEGORY_KEYWORDS = {
    '学校概况': ['校训', '食堂', '宿舍', '社团', '校区', '图书馆', '报到', '开学', '学费', '奖学金', '校史', '地图', '一卡通', '军训', '转专业', '校车', '体育'],
    '专业课程': ['离散数学', '软件工程', '课程', '复习', '教材', '知识点', '算法', '数据结构', '组成原理', '计算机网络', '操作系统', '数据库', '编译', '期末', '课件', '作业', '考试'],
    '面试刷题': ['面试', '刷题', 'CodeTop', '大厂', 'offer', '笔试', '简历', '面经', '算法题', '八股', '手撕'],
    'AI学习': ['Agent', 'RAG', '大模型', 'LLM', '智能体', '提示词', 'Prompt', '机器学习', '深度学习', 'Embedding', 'Rerank', '向量检索', 'AIGC'],
  };

  /**
   * 根据问题文本分类
   * @param {string} query
   * @returns {string} 类型 key
   */
  classifyQuestion(query) {
    const q = String(query || '');

    // 权威型：教务政策、规则、流程，答错可能误事
    if (/教务|选课|学分|毕业|学位|补考|重修|转专业|奖学金|处分|成绩|GPA|考试|报名|申请|条件|要求|规定|政策|规则|流程|手续|办法|制度|资格|审核|审批/.test(q))
      return RagService.QuestionType.AUTHORITATIVE;

    // 事实型：具体数字、名称、位置、时间
    if (/多少|几个|哪些|何时|哪里|谁|电话|地址|网站|邮箱|号码|比例|率|面积|人数|成立于|建于/.test(q))
      return RagService.QuestionType.FACTUAL;

    // 知识型：概念解释、知识点问答
    if (/什么是|解释|说说|区别|差异|不同|特点|特征|定义|概念|原理|方法|算法|为什么|如何|怎样|怎么|举例|说明|描述|理解|介绍|概述|总结|分类|组成|结构|功能|作用|优势|劣势|优缺点|比较|对比/.test(q))
      return RagService.QuestionType.KNOWLEDGE;

    return RagService.QuestionType.GENERAL;
  }

  /**
   * 获取问题类型对应的阈值配置
   * @param {string} query
   * @returns {{ minScore: number, rerankTopK: number, needSource: boolean, clamp: [number, number] }}
   */
  getTypeConfig(query) {
    const type = this.classifyQuestion(query);
    const config = RagService.TYPE_CONFIG[type] || RagService.TYPE_CONFIG.general;
    return { type, ...config };
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
    if (!this.autoCategoryFilter) return null;
    const q = String(query || '').trim();
    if (!q) return null;

    let bestCategory = null;
    let bestHits = 0;
    for (const [category, keywords] of Object.entries(RagService.DOC_CATEGORY_KEYWORDS)) {
      let hits = 0;
      for (const kw of keywords) {
        if (q.includes(kw)) hits++;
      }
      if (hits > bestHits) {
        bestHits = hits;
        bestCategory = category;
      }
    }

    // 至少命中 2 个关键词才认为足够置信（避免泛化问题被误过滤）
    return bestHits >= 2 ? bestCategory : null;
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
      console.log(`[QueryRewrite] "${query}" → "${rewritten}"`);
      return rewritten;
    } catch (err) {
      console.warn(`[QueryRewrite] 改写失败: ${err.message}`);
      return null;
    }
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
   * 自适应截断：保留高置信度父段，剔除低分和断崖段落
   * 策略：基础 Top N → 断崖检测 → 低分过滤 → 硬上限
   * @param {Array} candidates - 父段落候选列表
   * @param {number} maxCount - 硬上限
   * @param {string} [query] - 问题原文，用于获取类型化阈值
   * @returns {Array} 截断后的候选列表
   */
  _adaptiveTruncate(candidates, maxCount, query) {
    if (!candidates || candidates.length === 0) return [];
    if (candidates.length <= 1) return candidates;

    // 获取类型化阈值配置
    const typeConfig = query ? this.getTypeConfig(query) : null;
    const effectiveMaxCount = typeConfig ? typeConfig.rerankTopK : maxCount;
    const baseMinScore = typeConfig ? typeConfig.minScore : 0.30;
    const clamp = typeConfig ? typeConfig.clamp : [0.20, 0.50];

    // 先按 rerank 分数降序排列（理论上已经排好了，但保险一下）
    const sorted = [...candidates].sort(
      (a, b) => (b._rerankScore || 0) - (a._rerankScore || 0)
    );

    let cutoff = sorted.length;

    // 1. 断崖检测：找到第一个分差 > 0.05 的位置（至少保留 1 个）
    let cliffCutoff = sorted.length;
    for (let i = 1; i < sorted.length; i++) {
      const gap = (sorted[i - 1]._rerankScore || 0) - (sorted[i]._rerankScore || 0);
      if (gap > 0.05) {
        cliffCutoff = i;
        break;
      }
    }

    // 2. 动态低分过滤：根据问题类型调整 minScore
    //    策略：以 baseMinScore 为基准，结合分数分布做 clamp
    const topScore = sorted[0]._rerankScore || 0;
    // 如果 top1 分数已经很高（>0.8），说明检索质量好，可以适当放宽阈值
    // 如果 top1 分数很低（<0.3），说明检索质量差，收紧阈值避免噪声
    let dynamicMinScore;
    if (topScore > 0.8) {
      dynamicMinScore = Math.max(clamp[0], baseMinScore - 0.05);
    } else if (topScore < 0.3) {
      dynamicMinScore = Math.min(clamp[1], baseMinScore + 0.10);
    } else {
      dynamicMinScore = baseMinScore;
    }
    // 最终 clamp 到 [clamp[0], clamp[1]]
    dynamicMinScore = Math.max(clamp[0], Math.min(clamp[1], dynamicMinScore));

    // 低分过滤优先：严格排除所有低于动态阈值的候选；
    // 否则按断崖截断（保留分界后的第一个，避免过度截断）
    const scoreCutoff = sorted.findIndex(c => (c._rerankScore || 0) < dynamicMinScore);
    if (scoreCutoff >= 0 && scoreCutoff <= cliffCutoff) {
      cutoff = scoreCutoff;
    } else {
      cutoff = cliffCutoff + 1;
    }

    // 3. 硬上限 effectiveMaxCount（至少保留 1 个）
    const result = sorted.slice(0, Math.max(1, Math.min(cutoff, effectiveMaxCount)));

    // 4. 如果截断后只剩 1 个，且第 2 个分数够高，放宽到至少 2 个提高多样性
    if (result.length === 1 && sorted.length >= 2 && (sorted[1]._rerankScore || 0) > dynamicMinScore) {
      result.push(sorted[1]);
    }

    return result;
  }

  /**
   * 字符 bigram 集合：中文文本相似度的轻量特征（零模型调用）
   */
  _charBigrams(text) {
    const s = String(text || '').replace(/\s+/g, '');
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  }

  /**
   * 字符 bigram Jaccard 相似度（0~1）
   */
  _jaccardBigrams(setA, setB) {
    if (!setA || !setB || setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    for (const gram of setA) if (setB.has(gram)) intersection++;
    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0;
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
    if (!this.mmrEnabled || !Array.isArray(parentCandidates) || parentCandidates.length <= 1) return parentCandidates || [];

    const limit = Math.min(maxCount > 0 ? maxCount : parentCandidates.length, parentCandidates.length);
    if (limit <= 1) return parentCandidates.slice(0, 1);

    const textOf = (c) => c.parentText || c.bestChunk?.text || '';
    const scoreOf = (c) => c._rerankScore ?? c.bestChunk?.score ?? c.score ?? 0;

    const bigramSets = parentCandidates.map(c => this._charBigrams(textOf(c)));
    const simCache = new Map();
    const similarity = (i, j) => {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (!simCache.has(key)) simCache.set(key, this._jaccardBigrams(bigramSets[i], bigramSets[j]));
      return simCache.get(key);
    };

    // 按相关性降序
    const order = parentCandidates
      .map((_, i) => i)
      .sort((a, b) => scoreOf(parentCandidates[b]) - scoreOf(parentCandidates[a]));

    const selected = [order[0]];
    const remaining = order.slice(1);

    while (selected.length < limit && remaining.length > 0) {
      let bestIdx = -1;
      let bestVal = -Infinity;
      for (const i of remaining) {
        let maxSim = 0;
        for (const j of selected) {
          // 相似度剔除仅限同 docId 内父段：跨文档内容高度相似时也保留，
          // 避免把第二个相关文档整体剔掉（2026-08-09 回归修复，C01-C08 曾漏 doc_9a78）
          if (parentCandidates[i].docId !== parentCandidates[j].docId) continue;
          maxSim = Math.max(maxSim, similarity(i, j));
        }
        // 与已选父段过于相似 → 冗余，直接剔除
        if (maxSim >= this.mmrMaxSim) continue;
        const val = this.mmrLambda * scoreOf(parentCandidates[i]) - (1 - this.mmrLambda) * maxSim;
        if (val > bestVal) {
          bestVal = val;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) break;
      selected.push(bestIdx);
      remaining.splice(remaining.indexOf(bestIdx), 1);
    }

    return selected.map(i => parentCandidates[i]);
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
  async _buildContextFromParents(parentCandidates) {
    if (!parentCandidates || parentCandidates.length === 0) {
      return { sources: [], context: '' };
    }
    // 按 rerank 分数排序（rerank 已对所有父段打分，取高分优先）
    parentCandidates.sort((a, b) => (b._rerankScore || b.bestChunk?.score || 0) - (a._rerankScore || a.bestChunk?.score || 0));
    const selected = parentCandidates;

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

      if (totalLength + entry.length > this.maxContextLength) {
        const remaining = this.maxContextLength - totalLength;
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
    return {
      text: existing.text || incoming.text || '',
      title: existing.title || incoming.title || '',
      category: existing.category || incoming.category || '',
      docId: existing.docId || incoming.docId || '',
      parentId: existing.parentId || incoming.parentId || existing.docId || incoming.docId || '',
      chunkIndex: existing.chunkIndex ?? incoming.chunkIndex ?? -1,
    };
  }

  _normalizeScore(score) {
    if (!Number.isFinite(score)) return 0;
    return Math.max(0, Math.min(1, score));
  }

  _buildNoReliableSourcesReply() {
    return '知识库中没有检索到足够可靠的来源。请换一种问法，或先在知识库中上传/补充相关文档后再试。';
  }
}

module.exports = { RagService, metrics };













