/**
 * 离线 A/B：不同 Embedding 模型的稠密检索质量对比
 *
 * 动机：当前生产模型为 Xenova/bge-small-zh-v1.5（512d，24MB）。
 * 升级 bge-base-zh-v1.5（768d，~100MB）可能提升语义召回，但需全量重建索引，
 * 先用本脚本在本地语料上离线对比，数据说话后再决定是否切换
 * （切换方式：EMBEDDING_MODEL 环境变量 + 全量重建索引）。
 *
 * 与官方 eval-retrieval.js 的区别：完全不依赖后端/Qdrant——
 * 直接读 ragdata/*.md 构建段落级语料，ground truth 由 ground_truth 文本反查所属文件得出，
 * 因此指标口径是"文件级 Recall@5/MRR/nDCG@5"，绝对值与线上一致但不完全相同，
 * 用于**横向对比两个模型**是公平的（同一语料同一查询同一指标）。
 *
 * 用法：
 *   cd scripts/rag-eval && node offline-embedding-ab.cjs
 *   node offline-embedding-ab.cjs Xenova/bge-small-zh-v1.5 Xenova/bge-base-zh-v1.5
 *
 * 注意：bge-base 首次运行需联网下载 ~100MB 到 .model-cache；失败会跳过该模型。
 */
"use strict";

const { readFileSync, readdirSync, statSync, existsSync } = require('fs');
const { resolve, join, dirname } = require('path');

const ROOT = resolve(__dirname, '..', '..');
const RAGDATA_DIR = resolve(ROOT, 'ragdata');
const DATASET = resolve(__dirname, 'dataset', 'full-coverage-qa.json');
const MODEL_CACHE = resolve(ROOT, '.model-cache');
// 段落切分目标长度：与 indexing.service._mergeShortParagraphs 的 minLen=30 对齐
const MERGE_MIN_LEN = 30;
const MAX_CHUNKS_PER_FILE = 400;

const MODELS = process.argv.slice(2).filter(a => !a.startsWith('-')).length
  ? process.argv.slice(2).filter(a => !a.startsWith('-'))
  : ['Xenova/bge-small-zh-v1.5', 'Xenova/bge-base-zh-v1.5'];

// ---------- 语料加载 ----------
function listMarkdownFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...listMarkdownFiles(full));
    } else if (/\.md$/i.test(name)) {
      results.push(full);
    }
  }
  return results;
}

/** 段落切分 + 相邻短段合并（简化复刻 indexing.service 的父级切片逻辑） */
function splitParagraphs(text) {
  const raw = String(text || '').split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  const merged = [];
  let buffer = [];
  const flush = () => {
    if (buffer.length) { merged.push(buffer.join('\n')); buffer = []; }
  };
  for (const p of raw) {
    if (p.length < MERGE_MIN_LEN) {
      buffer.push(p);
    } else {
      flush();
      merged.push(p);
    }
  }
  flush();
  return merged;
}

function loadCorpus() {
  const files = listMarkdownFiles(RAGDATA_DIR);
  const docs = []; // { id(文件名), text(全文归一化), chunks: [{id, text}] }
  let totalChunks = 0;
  for (const file of files) {
    const rel = file.slice(RAGDATA_DIR.length + 1);
    const text = readFileSync(file, 'utf-8');
    const chunks = splitParagraphs(text)
      .slice(0, MAX_CHUNKS_PER_FILE)
      .map((c, i) => ({ id: `${rel}#p${i}`, text: c }));
    // 归一化全文用于 ground_truth 反查
    const normalized = text.replace(/\s+/g, '');
    docs.push({ id: rel, normalizedText: normalized, chunks });
    totalChunks += chunks.length;
  }
  console.log(`语料: ${docs.length} 个文件 / ${totalChunks} 个段落块`);
  return docs;
}

// ---------- ground truth 反查 ----------
function normalizeForMatch(s) {
  return String(s || '').replace(/[\s。，、！？：；""''()（）.,!:?'"-]+/g, '');
}

/** 用 ground_truth 在哪些文件的原文中出现 → 相关文件集合 */
function inferRelevantDocs(docs, groundTruth) {
  const needle = normalizeForMatch(groundTruth);
  if (!needle || needle.length < 4) return [];
  return docs.filter(d => d.normalizedText.includes(needle)).map(d => d.id);
}

// ---------- 指标（与 offline-rrf-ab 同口径） ----------
function computeNdcg(ids, relevantSet, k) {
  const dcg = ids.slice(0, k).reduce((s, id, i) => s + (relevantSet.has(id) ? 1 / Math.log2(i + 2) : 0), 0);
  const ideal = Array.from({ length: Math.min(relevantSet.size, k) }).reduce((s, _, i) => s + 1 / Math.log2(i + 2), 0);
  return ideal > 0 ? Math.min(dcg / ideal, 1) : 0;
}
function metrics(fileOrder, relevantIds) {
  const rel = new Set(relevantIds);
  const ids = [...new Set(fileOrder)];
  const hits = [...rel].filter(id => ids.includes(id));
  const recall5 = ids.slice(0, 5).filter(id => rel.has(id)).length / rel.size;
  let mrr = 0;
  for (let i = 0; i < ids.length; i++) {
    if (rel.has(ids[i])) { mrr = 1 / (i + 1); break; }
  }
  return {
    hitRate: hits.length > 0 ? 1 : 0,
    recall5,
    mrr,
    ndcg5: computeNdcg(ids, rel, 5),
  };
}

// ---------- 单模型评测 ----------
async function evaluateModel(modelId, corpus, questions) {
  const { env, pipeline } = require('@huggingface/transformers');
  env.cacheDir = MODEL_CACHE;
  env.allowRemoteModels = true;
  env.allowLocalModels = false;

  let extractor = null;
  for (const dtype of ['q8', 'fp32']) {
    try {
      extractor = await pipeline('feature-extraction', modelId, { dtype });
      break;
    } catch (err) {
      if (dtype === 'fp32') throw err;
      console.warn(`[${modelId}] ${dtype} 权重不可用(${err.message})，尝试 fp32`);
    }
  }

  const dim = extractor.model.config.hidden_size;
  console.log(`[${modelId}] 模型加载完成 (${dim}d)`);

  // 嵌入全部块
  const t0 = Date.now();
  const chunkVectors = []; // 与 corpus chunk 顺序一一对应
  let done = 0;
  for (const doc of corpus) {
    for (const chunk of doc.chunks) {
      const out = await extractor(chunk.text, { pooling: 'cls', normalize: true });
      chunkVectors.push({ docId: doc.id, vec: Array.from(out.data) });
      done++;
      if (done % 200 === 0) console.log(`  [${modelId}] 已嵌入 ${done} 块...`);
    }
  }
  console.log(`  [${modelId}] ${chunkVectors.length} 块嵌入耗时 ${(Date.now() - t0) / 1000}s`);

  const agg = { hitRate: 0, recall5: 0, mrr: 0, ndcg5: 0 };
  let n = 0;
  const misses = [];

  for (const item of questions) {
    const relevant = inferRelevantDocs(corpus, item.ground_truth);
    if (relevant.length === 0) continue;

    const out = await extractor(item.question, { pooling: 'cls', normalize: true });
    const q = Array.from(out.data);

    // 文件级排名：同文件取最大余弦相似度
    const best = new Map();
    for (const cv of chunkVectors) {
      const s = cosine(q, cv.vec);
      const cur = best.get(cv.docId);
      if (!cur || s > cur.score) best.set(cv.docId, { id: cv.docId, score: s });
    }
    const order = [...best.values()].sort((a, b) => b.score - a.score).map(x => x.id);
    const m = metrics(order, relevant);
    n++;
    for (const k of Object.keys(agg)) agg[k] += m[k];
    if (m.recall5 < 1) misses.push(`${item.id}(r5=${m.recall5.toFixed(2)})`);
  }

  return { n, agg: normalizedAgg(agg, n), misses, dim };
}

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // 已归一化向量点积即余弦
}

function normalizedAgg(agg, n) {
  if (!n) return null;
  const out = {};
  for (const [k, v] of Object.entries(agg)) out[k] = v / n;
  return out;
}

// ---------- 主流程 ----------
(async () => {
  const corpus = loadCorpus();
  const dataset = JSON.parse(readFileSync(DATASET, 'utf-8'));
  const questions = dataset.filter(q => q.ground_truth);
  console.log(`评测集: ${questions.length} 题（ground_truth 反查相关文件）\n`);

  const results = {};
  for (const model of MODELS) {
    console.log(`\n===== ${model} =====`);
    try {
      results[model] = await evaluateModel(model, corpus, questions);
    } catch (err) {
      console.warn(`[${model}] 评测失败，跳过: ${err.message}`);
    }
  }

  console.log('\n========================================');
  console.log('模型对比（文件级，有效样本数见括号）');
  console.log('─────────────────────────────────────────');
  for (const [model, r] of Object.entries(results)) {
    if (!r) continue;
    const pct = v => `${(v * 100).toFixed(1)}%`;
    console.log(
      `${model} (${r.dim}d, n=${r.n})\n` +
      `  Recall@5 ${pct(r.agg.recall5)} | MRR ${r.agg.mrr.toFixed(3)} | nDCG@5 ${r.agg.ndcg5.toFixed(3)} | HitRate ${pct(r.agg.hitRate)}` +
      (r.misses.length ? `\n  未满分题: ${r.misses.join(', ')}` : ''),
    );
  }
  console.log('\n提示: 切换生产模型请设置 EMBEDDING_MODEL 后执行全量重索引（管理端 reindexAll）。');
})().catch(err => {
  console.error('A/B 失败:', err);
  process.exit(1);
});
