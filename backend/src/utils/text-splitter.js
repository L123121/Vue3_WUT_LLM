"use strict";

/**
 * 文本切片器
 */
class TextSplitter {
  constructor(options = {}) {
    this.chunkSize = options.chunkSize || 500;  // 每段最大字符数
    this.chunkOverlap = options.chunkOverlap || 50;  // 重叠字符数
    this.separator = options.separator || '\n\n';
  }

  /**
   * 按段落分割文本
   * @param {string} text - 原始文本
   * @returns {string[]} 切片数组
   */
  splitByParagraph(text) {
    if (!text) return [];

    const paragraphs = text.split(/\n\n+/);
    const chunks = [];
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      // 如果当前段落本身超过限制，需要进一步分割
      if (paragraph.length > this.chunkSize) {
        // 先保存当前积累的内容
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        // 按句子分割长段落
        const sentences = this.splitBySentence(paragraph);
        chunks.push(...sentences);
      } else if (currentChunk.length + paragraph.length > this.chunkSize) {
        // 当前块已满，保存并开始新块
        chunks.push(currentChunk.trim());
        // 保留重叠部分
        const overlapText = currentChunk.slice(-this.chunkOverlap);
        currentChunk = overlapText + paragraph;
      } else {
        // 添加到当前块
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      }
    }

    // 保存最后一块
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks.filter(c => c.length > 0);
  }

  /**
   * 按句子分割长文本
   * @param {string} text - 文本
   * @returns {string[]} 句子数组
   */
  splitBySentence(text) {
    const sentences = text.split(/(?<=[。！？.!?])\s*/);
    const chunks = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > this.chunkSize) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
        // 如果单个句子超过限制，强制分割
        if (sentence.length > this.chunkSize) {
          const forcedChunks = this.forceSplit(sentence);
          chunks.push(...forcedChunks);
          currentChunk = '';
        } else {
          currentChunk = sentence;
        }
      } else {
        currentChunk += sentence;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * 强制分割超长文本
   * @param {string} text - 文本
   * @returns {string[]} 切片数组
   */
  forceSplit(text) {
    const chunks = [];
    for (let i = 0; i < text.length; i += this.chunkSize - this.chunkOverlap) {
      chunks.push(text.slice(i, i + this.chunkSize));
    }
    return chunks;
  }
}

module.exports = { TextSplitter };
