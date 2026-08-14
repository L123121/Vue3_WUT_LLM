/**
 * 快速检索评测（仅测检索质量，不等 LLM 生成）
 * 与 eval-retrieval.js 指标逻辑一致，但流式读取时收到 sources 事件即断开连接，
 * 把单题耗时从 ~22s（等 LLM 流完）降到 ~2s（检索完成），32 题可在 90s 内跑完。
 * 用法: node eval-retrieval-fast.mjs [dataset.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { withRetry, checkBackendHealth } from './utils/api-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(__dirname, 'dataset/full-coverage-qa.json');
const RESULTS_DIR = resolve(__dirname, 'results');
mkdirSync(RESULTS_DIR, { recursive: true });
const EVAL_KS = [1, 3, 5];

/**
 * 调用线上流式接口，收到 sources 事件立即断开（不等 LLM 生成）
 */
export async function ragQuerySourcesOnly(question, history = [], options = {}) {
  const controller = new AbortController();
  const url = `${process.env.BACKEND_URL || 'http://localhost:3000'}/api/rag/chat/stream`;
  const cookie = process.env.RAG_EVAL_COOKIE || '';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ message: question, history, category: options.category }),
    signal: controller.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`RAG API 请求失败: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sources = [];
  let retrieval = null;
  let answer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE 事件以空行分隔
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const p = JSON.parse(data);
            if (p.sources) sources = p.sources;
            if (p.retrieval) retrieval = p.retrieval;
            if (p.content) answer += p.content;
          } catch { /* ignore non-JSON */ }
        }
        // 关键：拿到 sources 后立即断开，不等 LLM 流完
        if (sources.length > 0) {
          controller.abort();
          return { answer: '', sources, retrieval };
        }
      }
    }
  } catch (err) {
    // abort 导致的读取中断属于预期行为
    if (err.name === 'AbortError') return { answer: '', sources, retrieval };
    throw err;
  }

  return { answer, sources, retrieval };
}

// ===== 指标计算（与 eval-retrieval.js 保持一致） =====
function getValidRelevantIds(relevantIds = []) {
  return relevantIds.filter(id => id && !id.startsWith('TODO'));
}
function computeDcg(retrievedIds, relevantSet, k) {
  return retrievedIds.slice(0, k).reduce((score, docId, index) => {
    if (!relevantSet.has(docId)) return score;
    return score + 1 / Math.log2(index + 2);
  }, 0);
}
function computeNdcgAtK(retrievedIds, relevantIds, k) {
  const relevantSet = new Set(relevantIds);
  if (!relevantSet.size) return 0;
  const dcg = computeDcg(retrievedIds, relevantSet, k);
  const idealHits = Math.min(relevantSet.size, k);
  const ideal = Array.from({ length: idealHits }).reduce((sum, _, index) => sum + 1 / Math.log2(index + 2), 0);
  return ideal > 0 ? dcg / ideal : 0;
}
function computeQueryMetrics(rawRetrievedIds, relevantIds) {
  const validRelevantIds = getValidRelevantIds(relevantIds);
  if (validRelevantIds.length === 0) return null;
  const retrievedIds = [...new Set(rawRetrievedIds)];
  const retrievedSet = new Set(retrievedIds);
  const hits = validRelevantIds.filter(id => retrievedSet.has(id));
  const hitCount = hits.length;
  const recall = hitCount / validRelevantIds.length;
  const precision = retrievedIds.length > 0 ? hitCount / retrievedIds.length : 0;
  let reciprocalRank = 0;
  for (let index = 0; index < retrievedIds.length; index++) {
    if (validRelevantIds.includes(retrievedIds[index])) {
      reciprocalRank = 1 / (index + 1);
      break;
    }
  }
  const rawNdcg = Object.fromEntries(EVAL_KS.map(k => [`ndcg@${k}`, computeNdcgAtK(retrievedIds, validRelevantIds, k)]));
  const ndcg = Object.fromEntries(Object.entries(rawNdcg).map(([k, v]) => [k, Math.min(v, 1.0)]));
  const recallAtK = Object.fromEntries(EVAL_KS.map(k => {
    const topK = retrievedIds.slice(0, k);
    return [`recall@${k}`, topK.filter(id => validRelevantIds.includes(id)).length / validRelevantIds.length];
  }));
  return { recall, precision, reciprocalRank, hitRate: hitCount > 0 ? 1 : 0, hitCount, totalRelevant: validRelevantIds.length, totalRetrieved: retrievedIds.length, firstRelevantRank: retrievedIds.findIndex(id => validRelevantIds.includes(id)) + 1, ...recallAtK, ...ndcg };
}
const percent = v => `${(v * 100).toFixed(1)}%`;
function buildGroupedStats(validResults, groupKey) {
  const grouped = {};
  for (const r of validResults) {
    const key = r[groupKey] || 'unknown';
    if (!grouped[key]) grouped[key] = { count: 0, recall: 0, precision: 0, mrr: 0, ndcg5: 0, hitRate: 0 };
    grouped[key].count++;
    grouped[key].recall += r.metrics.recall;
    grouped[key].precision += r.metrics.precision;
    grouped[key].mrr += r.metrics.reciprocalRank;
    grouped[key].ndcg5 += r.metrics['ndcg@5'];
    grouped[key].hitRate += r.metrics.hitRate;
  }
  for (const s of Object.values(grouped)) {
    s.recall = percent(s.recall / s.count);
    s.precision = percent(s.precision / s.count);
    s.hitRate = percent(s.hitRate / s.count);
    s.mrr = (s.mrr / s.count).toFixed(3);
    s.ndcg5 = (s.ndcg5 / s.count).toFixed(3);
  }
  return grouped;
}

export async function runFastRetrievalEval(options = {}) {
  const { verbose = true } = options;
  console.log('\n===== 快速检索评测（仅取 sources，不等 LLM） =====');
  const healthy = await checkBackendHealth();
  if (!healthy) { console.error('❌ 后端不可用'); return null; }
  console.log(`✅ 后端正常 (${process.env.BACKEND_URL || 'http://localhost:3000'})\n`);

  const dataset = JSON.parse(readFileSync(DATASET_PATH, 'utf-8'));
  console.log(`📋 评测集: ${dataset.length} 条\n`);

  const results = [];
  for (let index = 0; index < dataset.length; index++) {
    const item = dataset[index];
    const progress = `[${index + 1}/${dataset.length}]`;
    const validRelevantIds = getValidRelevantIds(item.relevant_doc_ids);
    if (validRelevantIds.length === 0) { console.log(`${progress} ⏭️ ${item.id}: 无有效文档ID，跳过`); continue; }
    try {
      if (verbose) process.stdout.write(`${progress} 🔍 ${item.id}: ${item.question.substring(0, 36)}...`);
      const { sources } = await withRetry(() => ragQuerySourcesOnly(item.question, [], { category: item.category }), 3, 1500);
      const retrievedIds = sources.map(s => s.id).filter(Boolean);
      const metrics = computeQueryMetrics(retrievedIds, item.relevant_doc_ids);
      results.push({ id: item.id, question: item.question, category: item.category, difficulty: item.difficulty, groundTruthDocIds: item.relevant_doc_ids, retrievedIds, metrics, sources });
      if (verbose) {
        const ok = metrics && metrics.hitRate === 1;
        console.log(` ${ok ? '✅' : '⚠️'} recall=${metrics ? percent(metrics.recall) : 'n/a'} ndcg@5=${metrics ? metrics['ndcg@5'].toFixed(3) : 'n/a'}`);
      }
    } catch (err) {
      console.log(` ❌ ${err.message}`);
      results.push({ id: item.id, question: item.question, category: item.category, difficulty: item.difficulty, metrics: null, error: err.message });
    }
  }

  const valid = results.filter(r => r.metrics !== null);
  const overall = valid.length ? {
    recall: percent(valid.reduce((s, r) => s + r.metrics.recall, 0) / valid.length),
    precision: percent(valid.reduce((s, r) => s + r.metrics.precision, 0) / valid.length),
    mrr: (valid.reduce((s, r) => s + r.metrics.reciprocalRank, 0) / valid.length).toFixed(3),
    hitRate: percent(valid.reduce((s, r) => s + r.metrics.hitRate, 0) / valid.length),
    ...Object.fromEntries(EVAL_KS.map(k => [`recall@${k}`, percent(valid.reduce((s, r) => s + r.metrics[`recall@${k}`], 0) / valid.length)])),
    ...Object.fromEntries(EVAL_KS.map(k => [`ndcg@${k}`, (valid.reduce((s, r) => s + r.metrics[`ndcg@${k}`], 0) / valid.length).toFixed(3)])),
  } : {};

  console.log('\n\n📊 检索质量评测结果');
  console.log('─────────────────────────────────');
  console.log(`  有效样本: ${valid.length} / ${dataset.length}`);
  console.log(`  Recall: ${overall.recall}`);
  console.log(`  Precision: ${overall.precision}`);
  console.log(`  Hit Rate: ${overall.hitRate}`);
  console.log(`  MRR: ${overall.mrr}`);
  console.log(`  nDCG@5: ${overall['ndcg@5']}`);
  console.log('─────────────────────────────────');
  console.log('  按类别:');
  for (const [category, stats] of Object.entries(buildGroupedStats(valid, 'category'))) {
    console.log(`    ${category}: recall=${stats.recall} precision=${stats.precision} mrr=${stats.mrr} ndcg@5=${stats.ndcg5} (n=${stats.count})`);
  }
  const output = { overall, byCategory: buildGroupedStats(valid, 'category'), byDifficulty: buildGroupedStats(valid, 'difficulty'), results, timestamp: new Date().toISOString() };
  const outputPath = resolve(RESULTS_DIR, 'fast-retrieval-results.json');
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n💾 结果已保存: ${outputPath}`);
  return output;
}

if (process.argv[1] && process.argv[1].includes('eval-retrieval-fast')) {
  runFastRetrievalEval().catch(err => { console.error('Eval error:', err.message); process.exit(1); });
}
