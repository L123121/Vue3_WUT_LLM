"use strict";

const { VectorStoreService } = require('./vector-store.service');
const { EmbeddingService } = require('./embedding.service');

/**
 * 文档索引管道
 *
 * 两层父子切片架构：
 *   父级 = 段落（按 \n\n 分割） → 作为 LLM 上下文
 *   子级 = 句子（按 。！？.!? 分割） → 向量化存入 Milvus 用于检索
 *
 * 检索流程：匹配子级句子 → 取父级段落作为上下文注入 LLM
 */
class IndexingService {
  constructor() {
    this.vectorStore = new VectorStoreService();
    this.embeddingService = new EmbeddingService();
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
   * 将段落按句子分割
   * 注意：选项行（如 "A. 内容"）中的英文句点不被视为句子边界
   */
  _splitSentences(paragraph) {
    // 先保护选项行（如 "A. 内容" 或 "- A. 内容"），避免被英文句点误切
    // 用占位符替换选项行中的句点，切完再还原
    const _protected = paragraph.replace(/^([- ]*[A-D])\.\s/gm, '$1<DOT>');
    // 匹配中文/英文句号、感叹号、问号、省略号
    const parts = _protected.split(/(?<=[。！？.!?\n])\s*/);
    return parts.map(s => s.trim().replace(/<DOT>/g, '.')).filter(s => s.length > 0);
  }

  /**
   * 索引单个文档（段落→句子双层切片 → 向量化子级 → 存储到 Milvus）
   */
  async indexDocument(docId, title, content, category = 'general') {
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

    // 3. 向量化子级（句子）
    const embeddings = await this.embeddingService.embedBatch(childChunks);
    if (!embeddings || embeddings.some(e => !e?.dense)) {
      console.warn(`[Indexing] 文档 ${docId} 向量化失败，跳过索引`);
      return 0;
    }

    // 4. 构造 Milvus ID 并存储
    const ids = childChunks.map((_, i) => `${docId}_sent_${i}`);

    await this.vectorStore.addChunks(ids, embeddings, childChunks, metadatas);
    console.log(`[Indexing] 文档索引完成: ${docId}, ${childChunks.length} 个句子向量`);
    return childChunks.length;
  }

  async removeDocument(docId) {
    await this.vectorStore.deleteByDocId(docId);
    console.log(`[Indexing] 文档索引已删除: ${docId}`);
  }

  async reindexDocument(docId, title, content, category = 'general') {
    await this.removeDocument(docId);
    return await this.indexDocument(docId, title, content, category);
  }

  async reindexAll(docs) {
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
