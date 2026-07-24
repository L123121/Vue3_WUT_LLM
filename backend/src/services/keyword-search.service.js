"use strict";

const { redis: store } = require('./memory-store');
const { TextSplitter } = require('../utils/text-splitter');

const DEFAULT_BM25_K1 = 1.5;
const DEFAULT_BM25_B = 0.75;

class KeywordSearchService {
  constructor() {
    this.splitter = new TextSplitter({ chunkSize: 500, chunkOverlap: 50 });
  }

  async search(query, options = {}) {
    const { topK = 10, category = null } = options;
    const queryTokens = this._tokenize(query);
    if (!queryTokens.length) return [];

    const chunks = await this._loadChunks({ category });
    if (!chunks.length) return [];

    const corpus = chunks.map(chunk => this._tokenize(`${chunk.title} ${chunk.text}`));
    const docFreq = this._buildDocumentFrequency(corpus);
    const avgDocLength = corpus.reduce((sum, tokens) => sum + tokens.length, 0) / corpus.length;
    const queryTokenSet = [...new Set(queryTokens)];

    const scored = chunks.map((chunk, index) => {
      const tokens = corpus[index];
      const termFreq = this._buildTermFrequency(tokens);
      const bm25 = this._bm25(queryTokenSet, termFreq, docFreq, tokens.length, avgDocLength, corpus.length);
      const titleBoost = this._titleBoost(queryTokenSet, chunk.title);
      const phraseBoost = this._phraseBoost(query, chunk.text);
      return {
        ...chunk,
        score: bm25 + titleBoost + phraseBoost,
        _keywordScore: bm25 + titleBoost + phraseBoost,
      };
    })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    const maxScore = scored[0]?.score || 1;
    return scored.slice(0, topK).map((item, rank) => ({
      ...item,
      score: item.score / maxScore,
      _keywordScore: item.score / maxScore,
      _keywordRank: rank + 1,
    }));
  }

  async _loadChunks({ category = null } = {}) {
    const docIds = await store.smembers('documents:all');
    if (!docIds.length) return [];

    const pipeline = store.pipeline();
    docIds.forEach(id => pipeline.hgetall(`document:${id}`));
    const results = await pipeline.exec();

    const chunks = [];
    for (const [, rawDoc] of results) {
      if (!rawDoc?.id || !rawDoc.content) continue;
      if (category && rawDoc.category !== category) continue;

      const pieces = this.splitter.splitByParagraph(rawDoc.content);
      pieces.forEach((text, chunkIndex) => {
        chunks.push({
          id: `${rawDoc.id}_chunk_${chunkIndex}`,
          docId: rawDoc.id,
          text,
          title: rawDoc.title || '',
          category: rawDoc.category || 'general',
          chunkIndex,
        });
      });
    }

    return chunks;
  }

  _bm25(queryTokens, termFreq, docFreq, docLength, avgDocLength, docCount) {
    let score = 0;
    const lengthNorm = avgDocLength > 0 ? docLength / avgDocLength : 1;

    for (const token of queryTokens) {
      const freq = termFreq.get(token) || 0;
      if (!freq) continue;

      const df = docFreq.get(token) || 0;
      const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
      const numerator = freq * (DEFAULT_BM25_K1 + 1);
      const denominator = freq + DEFAULT_BM25_K1 * (1 - DEFAULT_BM25_B + DEFAULT_BM25_B * lengthNorm);
      score += idf * (numerator / denominator);
    }

    return score;
  }

  _buildDocumentFrequency(corpus) {
    const docFreq = new Map();
    for (const tokens of corpus) {
      for (const token of new Set(tokens)) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
      }
    }
    return docFreq;
  }

  _buildTermFrequency(tokens) {
    const termFreq = new Map();
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    }
    return termFreq;
  }

  _titleBoost(queryTokens, title = '') {
    if (!title) return 0;
    const normalizedTitle = title.toLowerCase();
    const hits = queryTokens.filter(token => normalizedTitle.includes(token)).length;
    return hits ? Math.min(0.3, hits / queryTokens.length * 0.3) : 0;
  }

  _phraseBoost(query, text = '') {
    const normalizedQuery = this._normalize(query);
    if (normalizedQuery.length < 3) return 0;
    return this._normalize(text).includes(normalizedQuery) ? 0.2 : 0;
  }

  _tokenize(text = '') {
    const normalized = this._normalize(text);
    const tokens = new Set();

    const englishWords = normalized.match(/[a-z0-9]{2,}/g) || [];
    englishWords.forEach(word => tokens.add(word));

    const chineseRuns = normalized.match(/[\u4e00-\u9fff]+/g) || [];
    for (const run of chineseRuns) {
      for (let size = 2; size <= 4; size++) {
        if (run.length < size) continue;
        for (let index = 0; index <= run.length - size; index++) {
          tokens.add(run.slice(index, index + size));
        }
      }
      if (run.length <= 4) tokens.add(run);
    }

    return [...tokens];
  }

  _normalize(text = '') {
    return String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  }
}

module.exports = { KeywordSearchService };
