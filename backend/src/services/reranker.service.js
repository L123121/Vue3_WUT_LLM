"use strict";

/**
 * Cross-encoder reranker using BGE-reranker-base (INT8, ~278MB)
 *
 * Uses @xenova/transformers local ONNX inference — no API calls.
 * Replaces the 2-gram sliding-window keyword rerank with semantic reranking.
 *
 * Model: Xenova/bge-reranker-base (ONNX quantized, int8)
 * Cache: .model-cache/Xenova/bge-reranker-base/
 */
const path = require('path');

const MODEL_NAME = 'Xenova/bge-reranker-base';
const MODEL_CACHE_DIR = path.resolve(__dirname, '../../../.model-cache');

let modelInstance = null;
let loadPromise = null;

class RerankerService {
  /**
   * Lazy-load the reranker model (singleton)
   */
  async _loadModel() {
    if (modelInstance) return modelInstance;
    if (loadPromise) return loadPromise;

    loadPromise = this._doLoad();
    try {
      modelInstance = await loadPromise;
      return modelInstance;
    } catch (err) {
      loadPromise = null; // reset so next call retries
      throw err;
    }
  }

  async _doLoad() {
    // 禁止远程加载，仅使用本地缓存（避免 HuggingFace Hub 被墙导致失败）
    const { env } = require('@xenova/transformers');
    env.allowRemoteModels = false;
    env.useFS = true;
    env.useFSCache = true;
    env.localModelPath = MODEL_CACHE_DIR;   // local_files_only 时从该目录找模型

    const { AutoTokenizer, AutoModelForSequenceClassification } = require('@xenova/transformers');

    console.log('[Reranker] 加载模型中:', MODEL_NAME);

    const tokenizer = await AutoTokenizer.from_pretrained(MODEL_NAME, {
      cache_dir: MODEL_CACHE_DIR,
      local_files_only: true,
    });

    const model = await AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, {
      quantized: true,          // 使用 model_uint8.onnx (~278MB)
      cache_dir: MODEL_CACHE_DIR,
      local_files_only: true,
    });

    console.log('[Reranker] 加载完成');
    return { tokenizer, model };
  }

  /**
   * 对候选列表做 cross-encoder rerank
   * @param {string} query - 用户原始 query
   * @param {Array<{text: string, score: number}>} candidates - 候选切片列表
   * @param {number} topK - 返回 topK 条
   * @returns {Promise<Array>} 重排后的切片列表（带 _rerankScore）
   */
  async rerank(query, candidates, topK = 5) {
    if (!candidates || candidates.length === 0) return [];
    if (candidates.length === 1) {
      candidates[0]._rerankScore = candidates[0].score || 0;
      candidates[0]._rerankModel = 'skip';
      return candidates;
    }

    let model;
    try {
      model = await this._loadModel();
    } catch (err) {
      console.warn('[Reranker] 模型加载失败，退回原始排序:', err.message);
      return candidates.slice(0, topK).map(c => ({ ...c, _rerankScore: c.score || 0, _rerankModel: 'fallback' }));
    }

    const { tokenizer, model: reranker } = model;

    try {
      const MAX_RERANK = 30;
      const needed = Math.min(candidates.length, Math.max(topK * 2, 10), MAX_RERANK); // 多取一些给 rerank 筛选，上限 30
      const slices = candidates.slice(0, needed);
      const texts = slices.map(c => String(c.text || ''));

      // Batch tokenize: 构造 (query, text) 对
      // BGE-reranker 官方格式: [CLS] query [SEP] passage [SEP] —— query 必须是主输入
      const inputs = await tokenizer(texts.map(() => query), {
        text_pair: texts,
        padding: true,
        truncation: true,
        max_length: 512,
        return_tensors: 'pt',
      });

      const outputs = await reranker(inputs);
      const logits = outputs.logits.data; // Float32Array

      // 对每个候选赋值 rerank 分数
      for (let i = 0; i < slices.length; i++) {
        // BGE-reranker 输出 logit，sigmoid 转成 0-1 分数
        const logit = logits[i] ?? 0;
        const score = 1 / (1 + Math.exp(-logit)); // sigmoid
        slices[i]._rerankScore = score;
        slices[i]._rerankModel = 'bge-reranker-base';
      }

      // 按 rerank 分数重排
      slices.sort((a, b) => b._rerankScore - a._rerankScore);
      return slices.slice(0, topK);
    } catch (err) {
      console.warn('[Reranker] 推理失败，退回原始排序:', err.message);
      return candidates.slice(0, topK).map(c => ({ ...c, _rerankScore: c.score || 0, _rerankModel: 'fallback' }));
    }
  }
}

module.exports = { RerankerService };

