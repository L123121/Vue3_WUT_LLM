/**
 * RAG 检索质量评测
 * 指标：Recall@K, Precision@K, MRR, Hit Rate, nDCG@K, Bad Case 分类
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ragQuery, withRetry, checkBackendHealth } from './utils/api-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = process.env.DATASET_PATH
  ? resolve(__dirname, process.env.DATASET_PATH)
  : resolve(__dirname, 'dataset/campus-qa.json');
const RESULTS_DIR = resolve(__dirname, 'results');
const EVAL_KS = [1, 3, 5];

mkdirSync(RESULTS_DIR, { recursive: true });

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

  // 父子段落架构下，多段落返回相同 docId，按 docId 去重后再算指标
  const retrievedIds = [...new Set(rawRetrievedIds)];
  const retrievedSet = new Set(retrievedIds);
  const hits = validRelevantIds.filter(id => retrievedSet.has(id));
  const hitCount = hits.length;
  const recall = hitCount / validRelevantIds.length;
  const precision = retrievedIds.length > 0 ? hitCount / retrievedIds.length : 0;

  let reciprocalRank = 0;
  let firstRelevantRank = null;
  for (let index = 0; index < retrievedIds.length; index++) {
    if (validRelevantIds.includes(retrievedIds[index])) {
      firstRelevantRank = index + 1;
      reciprocalRank = 1 / firstRelevantRank;
      break;
    }
  }

  // nDCG 上限为 1.0，防止去重前的重复 docId 导致分数溢出
  const rawNdcg = Object.fromEntries(EVAL_KS.map(k => [`ndcg@${k}`, computeNdcgAtK(retrievedIds, validRelevantIds, k)]));
  const ndcg = Object.fromEntries(Object.entries(rawNdcg).map(([k, v]) => [k, Math.min(v, 1.0)]));

  const recallAtK = Object.fromEntries(EVAL_KS.map(k => {
    const topK = retrievedIds.slice(0, k);
    const topHits = topK.filter(id => validRelevantIds.includes(id)).length;
    return [`recall@${k}`, topHits / validRelevantIds.length];
  }));

  return {
    recall,
    precision,
    reciprocalRank,
    hitRate: hitCount > 0 ? 1 : 0,
    hitCount,
    totalRelevant: validRelevantIds.length,
    totalRetrieved: retrievedIds.length,
    firstRelevantRank,
    missedRelevantIds: validRelevantIds.filter(id => !retrievedSet.has(id)),
    ...recallAtK,
    ...ndcg,
  };
}

function classifyBadCase({ metrics, retrievedIds, answer, error }) {
  if (error) return { type: 'api_error', reason: error };
  if (!metrics) return { type: 'skipped', reason: '未填写有效 relevant_doc_ids' };
  if (retrievedIds.length === 0) return { type: 'no_retrieval', reason: '没有返回任何来源文档' };
  if (metrics.hitRate === 0) return { type: 'recall_miss', reason: 'TopK 来源没有命中标准文档' };
  if (metrics.firstRelevantRank && metrics.firstRelevantRank > 3) {
    return { type: 'ranking_error', reason: `首个相关文档排在第 ${metrics.firstRelevantRank} 位` };
  }
  if (metrics.precision < 0.34) return { type: 'noisy_context', reason: '命中但无关来源比例偏高' };

  const refused = /没有检索到|资料不足|知识库中没有|无法回答/.test(answer || '');
  if (refused && metrics.hitRate > 0) return { type: 'generation_refusal', reason: '已命中来源但生成阶段拒答' };

  return { type: 'pass', reason: '检索命中且排序可接受' };
}

function averageMetric(results, field) {
  if (!results.length) return 0;
  return results.reduce((sum, result) => sum + (result.metrics?.[field] || 0), 0) / results.length;
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function buildGroupedStats(validResults, groupKey) {
  const grouped = {};
  for (const result of validResults) {
    const key = result[groupKey] || 'unknown';
    if (!grouped[key]) grouped[key] = { count: 0, recall: 0, precision: 0, mrr: 0, ndcg5: 0, hitRate: 0 };
    grouped[key].count++;
    grouped[key].recall += result.metrics.recall;
    grouped[key].precision += result.metrics.precision;
    grouped[key].mrr += result.metrics.reciprocalRank;
    grouped[key].ndcg5 += result.metrics['ndcg@5'];
    grouped[key].hitRate += result.metrics.hitRate;
  }

  for (const stats of Object.values(grouped)) {
    stats.recall = percent(stats.recall / stats.count);
    stats.precision = percent(stats.precision / stats.count);
    stats.hitRate = percent(stats.hitRate / stats.count);
    stats.mrr = (stats.mrr / stats.count).toFixed(3);
    stats.ndcg5 = (stats.ndcg5 / stats.count).toFixed(3);
  }

  return grouped;
}

function buildBadCaseStats(results) {
  const stats = {};
  for (const result of results) {
    const type = result.badCase?.type || 'unknown';
    if (!stats[type]) stats[type] = 0;
    stats[type]++;
  }
  return stats;
}

export async function runRetrievalEval(options = {}) {
  const { sampleSize = 0, verbose = true } = options;

  console.log('\n========================================');
  console.log('  RAG 检索质量评测');
  console.log('========================================\n');

  const healthy = await checkBackendHealth();
  if (!healthy) {
    console.error('❌ 后端服务不可用，请先启动后端: cd backend && npm run dev');
    return null;
  }
  console.log('✅ 后端服务正常\n');

  const dataset = JSON.parse(readFileSync(DATASET_PATH, 'utf-8'));
  const testSet = sampleSize > 0 ? dataset.slice(0, sampleSize) : dataset;
  console.log(`📋 评测集: ${testSet.length} 条（共 ${dataset.length} 条）\n`);

  const results = [];
  let skipped = 0;

  for (let index = 0; index < testSet.length; index++) {
    const item = testSet[index];
    const progress = `[${index + 1}/${testSet.length}]`;
    const validRelevantIds = getValidRelevantIds(item.relevant_doc_ids);

    if (validRelevantIds.length === 0) {
      if (verbose) console.log(`${progress} ⏭️  ${item.id}: ${item.question.substring(0, 30)}... (未填写文档ID，跳过)`);
      skipped++;
      continue;
    }

    try {
      if (verbose) process.stdout.write(`${progress} 🔍 ${item.id}: ${item.question.substring(0, 40)}...`);

      const { answer, sources, retrieval } = await withRetry(() => ragQuery(item.question, [], { category: item.category }));
      const retrievedIds = sources.map(source => source.id).filter(Boolean);
      const metrics = computeQueryMetrics(retrievedIds, item.relevant_doc_ids);
      const badCase = classifyBadCase({ metrics, retrievedIds, answer });

      results.push({
        id: item.id,
        question: item.question,
        category: item.category,
        difficulty: item.difficulty,
        groundTruthDocIds: item.relevant_doc_ids,
        retrievedIds,
        sources,
        metrics,
        badCase,
        retrieval,
        answer: answer.substring(0, 300),
      });

      if (verbose) {
        const status = badCase.type === 'pass' ? '✅' : '⚠️';
        console.log(` ${status} recall=${percent(metrics.recall)} ndcg@5=${metrics['ndcg@5'].toFixed(3)} badCase=${badCase.type}`);
      }
    } catch (err) {
      const badCase = classifyBadCase({ error: err.message, retrievedIds: [], answer: '' });
      console.error(` ❌ 错误: ${err.message}`);
      results.push({
        id: item.id,
        question: item.question,
        category: item.category,
        difficulty: item.difficulty,
        groundTruthDocIds: item.relevant_doc_ids,
        retrievedIds: [],
        metrics: null,
        badCase,
        error: err.message,
      });
    }
  }

  const validResults = results.filter(result => result.metrics !== null);
  if (validResults.length === 0) {
    console.log('\n⚠️  没有有效的评测结果（所有条目都缺少文档 ID）');
    console.log('   请先编辑 dataset/campus-qa.json，将 TODO_FILL_DOC_ID 替换为实际的文档 ID');
    console.log('   获取方式: GET http://localhost:3000/api/rag/documents');
    return null;
  }

  const overall = {
    recall: percent(averageMetric(validResults, 'recall')),
    precision: percent(averageMetric(validResults, 'precision')),
    mrr: averageMetric(validResults, 'reciprocalRank').toFixed(3),
    hitRate: percent(averageMetric(validResults, 'hitRate')),
    ...Object.fromEntries(EVAL_KS.map(k => [`recall@${k}`, percent(averageMetric(validResults, `recall@${k}`))])),
    ...Object.fromEntries(EVAL_KS.map(k => [`ndcg@${k}`, averageMetric(validResults, `ndcg@${k}`).toFixed(3)])),
  };

  const badCases = results.filter(result => result.badCase && result.badCase.type !== 'pass' && result.badCase.type !== 'skipped');
  const summary = {
    total: testSet.length,
    evaluated: validResults.length,
    skipped,
    overall,
    byCategory: buildGroupedStats(validResults, 'category'),
    byDifficulty: buildGroupedStats(validResults, 'difficulty'),
    byBadCase: buildBadCaseStats(results),
    badCaseCount: badCases.length,
  };

  console.log('\n\n📊 检索质量评测结果');
  console.log('─────────────────────────────────');
  console.log(`  有效样本: ${validResults.length} / ${testSet.length}`);
  console.log(`  跳过(无文档ID): ${skipped}`);
  console.log(`  Recall: ${summary.overall.recall}`);
  console.log(`  Precision: ${summary.overall.precision}`);
  console.log(`  Hit Rate: ${summary.overall.hitRate}`);
  console.log(`  MRR: ${summary.overall.mrr}`);
  console.log(`  nDCG@5: ${summary.overall['ndcg@5']}`);
  console.log('─────────────────────────────────');
  console.log('  按类别:');
  for (const [category, stats] of Object.entries(summary.byCategory)) {
    console.log(`    ${category}: recall=${stats.recall} precision=${stats.precision} mrr=${stats.mrr} ndcg@5=${stats.ndcg5} (n=${stats.count})`);
  }
  console.log('─────────────────────────────────');
  console.log('  Bad Case 分类:');
  for (const [type, count] of Object.entries(summary.byBadCase)) {
    console.log(`    ${type}: ${count}`);
  }

  if (badCases.length > 0) {
    console.log('─────────────────────────────────');
    console.log('  Bad Case 示例:');
    for (const item of badCases.slice(0, 10)) {
      console.log(`    ${item.id} [${item.badCase.type}] ${item.badCase.reason}`);
    }
  }

  const output = { summary, results, badCases, timestamp: new Date().toISOString() };
  const outputPath = resolve(RESULTS_DIR, 'retrieval-results.json');
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n💾 结果已保存: ${outputPath}`);

  return output;
}

if (process.argv[1] && process.argv[1].includes('eval-retrieval')) {
  runRetrievalEval().catch(console.error);
}
