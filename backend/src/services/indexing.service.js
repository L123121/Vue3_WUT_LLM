"use strict";

const crypto = require('crypto');
const { EmbeddingService } = require('./embedding.service');

/**
 * 文档索引管道
 *
 * 两层父子切片架构：
 *   父级 = 段落（按 \n\n 分割） → 作为 LLM 上下文
 *   子级 = 句子（按 。！？.!? 分割） → 向量化存入 Qdrant 用于检索
 *
 * 检索流程：匹配子级句子 → 取父级段落作为上下文注入 LLM
 *
 * 增量重索引：删除前按内容 hash 取回旧向量，文本未变的 chunk 直接复用 embedding
 * （embedding 是全链路最贵的本地计算），只重算变化的段落。
 */
class IndexingService {
  /**
   * @param {object} [vectorStore] - 向量库实例（默认使用全局单例）
   * @param {object} [embeddingService] - embedding 服务（可选，避免重复加载模型）
   */
  constructor(vectorStore = null, embeddingService = null) {
    // 延迟解析默认单例：避免模块加载时的循环依赖
    this._getVectorStore = vectorStore
      ? () => vectorStore
      : () => require('./vector-store.service').vectorStore;
    this.embeddingService = embeddingService || new EmbeddingService();
  }

  get vectorStore() { return this._getVectorStore(); }

  /** 最近一次 indexDocument 的复用统计 { reused, embedded, total }，供重索引接口展示 */
  get lastReuseStats() { return this._lastReuseStats || { reused: 0, embedded: 0, total: 0 }; }

  /** chunk 内容 hash：增量复用的对齐键（trim 归一化） */
  _contentHash(text) {
    return crypto.createHash('sha256').update(String(text || '').trim()).digest('hex');
  }

  /**
   * 取回文档现有向量并按内容 hash 建复用表
   * @returns {Promise<Map<string, {dense: number[], sparse: Object}> | null>}
   *          向量库不支持 getDocPoints 或取回失败时返回 null（退化为全量重算）
   */
  async _buildReuseMap(docId) {
    if (typeof this.vectorStore.getDocPoints !== 'function') return null;
    try {
      const oldPoints = await this.vectorStore.getDocPoints(docId);
      const map = new Map();
      for (const point of oldPoints) {
        if (!point?.dense?.length) continue;
        // Qdrant 线上 sparse 为 {indices, values}，归一化回 embedBatch 的 {dim: weight} map 形式
        let sparse = point.sparse || {};
        if (Array.isArray(sparse.indices)) {
          sparse = Object.fromEntries(sparse.indices.map((dim, i) => [dim, sparse.values[i]]));
        }
        map.set(this._contentHash(point.text), { dense: point.dense, sparse });
      }
      return map;
    } catch (err) {
      console.warn(`[Indexing] 取回旧向量失败，退化为全量重算: ${err.message}`);
      return null;
    }
  }

  /**
   * 将文本按段落分割（含碎片段落合并）
   *
   * 场景：mammoth 提取 DOCX 后产生大量碎片化短段落
   * （表格单元格逐行提取、单行键值属性等），检索命中时 LLM 拿到的上下文太短。
   *
   * 策略：
   *   1. 按 \n\n 初始分割
   *   2. 按 `一、` / `二、` / … 章节标题合并同节内所有段落为一个语义块
   *   3. 无章节标题时，退化为相邻短段落合并（< 30 字）
   */
  _splitParagraphs(text) {
    if (!text) return [];
    const rawParas = text.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);
    return this._mergeBySection(rawParas);
  }

  /**
   * 按章节标题或短段落合并
   */
  _mergeBySection(paragraphs) {
    if (!paragraphs.length) return [];

    const sectionHeadingRe = /^[一二三四五六七八九十]+[、.．]/;
    const hasSectionHeadings = paragraphs.some(p => sectionHeadingRe.test(p));

    if (hasSectionHeadings) {
      return this._mergeBySectionHeadings(paragraphs, sectionHeadingRe);
    }

    // 无章节标题 → 合并相邻短段落
    return this._mergeShortParagraphs(paragraphs);
  }

  /**
   * 按章节标题合并：两个标题之间的所有段落合并为一个语义块
   * 封面/目录等标题前的内容单独成块
   */
  _mergeBySectionHeadings(paragraphs, headingRe) {
    const merged = [];
    let buffer = [];

    const flushBuffer = () => {
      if (buffer.length > 0) {
        merged.push(buffer.join('\n'));
        buffer = [];
      }
    };

    for (const p of paragraphs) {
      if (headingRe.test(p)) {
        flushBuffer();      // 上一个章节结束
        buffer.push(p);     // 标题开始新章节
      } else {
        buffer.push(p);     // 内容属于当前章节
      }
    }
    flushBuffer();           // 最后一章

    return merged;
  }

  /**
   * 合并相邻短段落（无章节标题时兜底）
   * 同时对 Q&A 文档特殊处理：将题目、选项、答案合并为同一段落
   */
  _mergeShortParagraphs(paragraphs, minLen = 30) {
    const merged = [];
    let buffer = [];

    const flushBuffer = () => {
      if (buffer.length > 0) {
        merged.push(buffer.join('\n'));
        buffer = [];
      }
    };

    for (const p of paragraphs) {
      // Q&A 合并检测：题目行（### Q）、选项行（- A./- B./...）、答案行（**答案：**）
      // 这些行虽然长度可能超过 minLen，但应与前后内容合并为一个段落
      const isQuestionLine = /^###\s+Q\d/i.test(p);
      const isOptionLine = /^[- ]*[A-D]\./.test(p);
      const isAnswerLine = /^\*\*答案/.test(p);
      const isQAContent = isQuestionLine || isOptionLine || isAnswerLine;

      if (isQAContent) {
        // 题目行开始新段落，先刷出缓冲区
        if (isQuestionLine) flushBuffer();
        buffer.push(p);
      } else if (p.length < minLen) {
        buffer.push(p);
      } else {
        flushBuffer();
        merged.push(p);
      }
    }
    flushBuffer();

    return merged;
  }

  /**
   * 将段落按句子分割，并合并过短的相邻句子
   * 注意：选项行（如 "A. 内容"）中的英文句点不被视为句子边界
   *
   * 合并原因：按句末标点切分后，大量 < 10 字的碎片（目录项"一、学校概况3"、
   * 标题"目 录"、日期"2025年7月"）被独立向量化，语义稀薄且干扰检索。
   * 同一段落内相邻短句合并到目标长度，既消除碎片，又保留句子级的语义聚焦。
   *
   * @param {string} paragraph
   * @param {number} [targetMinLen=25] - 合并目标最小字数，累积到此长度输出
   */
  _splitSentences(paragraph, targetMinLen = 25) {
    // 先保护选项行（如 "A. 内容" 或 "- A. 内容"），避免被英文句点误切
    // 用占位符替换选项行中的句点，切完再还原
    const _protected = paragraph.replace(/^([- ]*[A-D])\.\s/gm, '$1<DOT>');
    // 匹配中文/英文句号、感叹号、问号、换行
    const parts = _protected.split(/(?<=[。！？.!?\n])\s*/);
    const sentences = parts.map(s => s.trim().replace(/<DOT>/g, '.')).filter(s => s.length > 0);

    // 单句段落无需合并
    if (sentences.length <= 1) return sentences;

    // 合并相邻短句，消除碎片向量
    return this._mergeShortSentences(sentences, targetMinLen);
  }

  /**
   * 同一段落内合并相邻短句
   *
   * 策略：顺序累积，达到 targetMinLen 后刷出一个 chunk；
   * 尾部残余若过短（< 10 字）则并入前一个 chunk，避免产生新的碎片。
   *
   * @param {string[]} sentences - 已切分的句子列表
   * @param {number} targetMinLen - 合并目标最小字数
   * @returns {string[]} 合并后的 chunk 列表
   */
  _mergeShortSentences(sentences, targetMinLen) {
    const merged = [];
    let buffer = '';

    for (const s of sentences) {
      buffer = buffer ? buffer + s : s;
      if (buffer.length >= targetMinLen) {
        merged.push(buffer);
        buffer = '';
      }
    }

    // 尾部残余处理：过短则并入前一个 chunk，否则独立成块
    if (buffer.length > 0) {
      if (merged.length > 0 && buffer.length < 10) {
        merged[merged.length - 1] += buffer;
      } else {
        merged.push(buffer);
      }
    }

    return merged;
  }

  /**
   * 索引单个文档（段落→句子双层切片 → 向量化子级 → 存储到 Qdrant）
   * @param {string} docId
   * @param {string} title
   * @param {string} content
   * @param {string} category
   * @param {Object} [options]
   * @param {Map|null} [options.oldVectors] - 内容 hash → 旧向量复用表（增量重索引用）
   */
  async indexDocument(docId, title, content, category = 'general', { oldVectors = null } = {}) {
    // 1. 按段落分割（父级）
    const paragraphs = this._splitParagraphs(content);
    if (!paragraphs.length) {
      console.warn(`[Indexing] 文档 ${docId} 段落数为 0，跳过索引`);
      return 0;
    }

    // 2. 按句子分割（子级），构造子块数据
    const childChunks = [];
    const metadatas = [];

    for (let paraIdx = 0; paraIdx < paragraphs.length; paraIdx++) {
      const paraText = paragraphs[paraIdx];
      const sentences = this._splitSentences(paraText);

      for (const sentence of sentences) {
        childChunks.push(sentence);
        metadatas.push({
          docId,
          parentId: `${docId}_para_${paraIdx}`,
          parentIdx: paraIdx,
          parentText: paraText,          // 父段落全文，检索时直接使用
          title,
          category,
          chunkIndex: metadatas.length,  // 句子级别的索引
        });
      }
    }

    if (!childChunks.length) {
      console.warn(`[Indexing] 文档 ${docId} 句子数为 0，跳过索引`);
      return 0;
    }

    console.log(`[Indexing] 文档切片: ${paragraphs.length} 段落 → ${childChunks.length} 句子`);

    // 3. 向量化子级：hash 命中旧向量直接复用，只对新增/变化的 chunk 调用模型
    const reused = new Array(childChunks.length).fill(null);
    const freshIdx = [];
    const freshTexts = [];
    if (oldVectors) {
      childChunks.forEach((text, i) => {
        const hit = oldVectors.get(this._contentHash(text));
        if (hit) reused[i] = hit;
        else freshIdx.push(i);
      });
    } else {
      freshIdx.push(...childChunks.map((_, i) => i));
    }

    if (freshIdx.length > 0) {
      freshIdx.forEach(i => freshTexts.push(childChunks[i]));
      const freshEmbeddings = await this.embeddingService.embedBatch(freshTexts);
      if (freshEmbeddings.some(e => !e?.dense)) {
        console.warn(`[Indexing] 文档 ${docId} 向量化失败，跳过索引`);
        return 0;
      }
      freshIdx.forEach((chunkIdx, j) => { reused[chunkIdx] = freshEmbeddings[j]; });
    }

    this._lastReuseStats = {
      reused: childChunks.length - freshIdx.length,
      embedded: freshIdx.length,
      total: childChunks.length,
    };
    if (oldVectors) {
      console.log(`[Indexing] 增量复用: ${childChunks.length - freshIdx.length}/${childChunks.length} 个向量免算，重算 ${freshIdx.length} 个`);
    }

    // 4. 构造 point ID（docId_sent_i，确定性可重放）并存储
    const ids = childChunks.map((_, i) => `${docId}_sent_${i}`);

    await this.vectorStore.addChunks(ids, reused, childChunks, metadatas);
    console.log(`[Indexing] 文档索引完成: ${docId}, ${childChunks.length} 个句子向量`);
    return childChunks.length;
  }

  async removeDocument(docId) {
    await this.vectorStore.deleteByDocId(docId);
    console.log(`[Indexing] 文档索引已删除: ${docId}`);
  }

  /**
   * 增量重索引：删除前先取回旧向量，文本未变的 chunk 复用 embedding
   */
  async reindexDocument(docId, title, content, category = 'general') {
    const oldVectors = await this._buildReuseMap(docId);
    await this.removeDocument(docId);
    return await this.indexDocument(docId, title, content, category, { oldVectors });
  }

  /**
   * 重建所有文档的索引
   * @param {Array} docs - 文档列表
   * @param {Object} [options]
   * @param {string} [options.mode='rebuild'] - rebuild: reset collection 后全量重建（修复/策略变更用）
   *                                            incremental: 逐文档 hash diff，未变 chunk 复用向量
   */
  async reindexAll(docs, { mode = 'rebuild' } = {}) {
    if (mode === 'incremental') {
      console.log(`[Indexing] 开始增量重索引，共 ${docs.length} 个文档`);
      let totalChunks = 0;
      for (const doc of docs) {
        totalChunks += await this.reindexDocument(doc.id, doc.title, doc.content, doc.category);
      }
      const { reused, embedded } = this.lastReuseStats;
      console.log(`[Indexing] 增量重索引完成，共 ${totalChunks} 个句子向量（复用 ${reused}，重算 ${embedded}）`);
      return totalChunks;
    }

    console.log(`[Indexing] 开始全量重建索引，共 ${docs.length} 个文档`);
    await this.vectorStore.resetCollection();

    let totalChunks = 0;
    for (const doc of docs) {
      const count = await this.indexDocument(doc.id, doc.title, doc.content, doc.category);
      totalChunks += count;
    }
    console.log(`[Indexing] 全量重建完成，共 ${totalChunks} 个句子向量`);
    return totalChunks;
  }
}

module.exports = { IndexingService };
