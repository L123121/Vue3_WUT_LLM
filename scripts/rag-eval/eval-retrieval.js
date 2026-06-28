/**
 * RAG 检索质量评测
 * 指标：Recall@K, Precision@K, MRR, Hit Rate
 *
 * 由于讯飞 ChatDoc 检索是黑盒，只能从 fileRefer 获取文件级引用，
 * 无法获取相似度分数，因此不做 NDCG 等需要分数的指标。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ragQuery, withRetry, checkBackendHealth } from './utils/api-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = resolve(__dirname, 'dataset/campus-qa.json');
const RESULTS_DIR = resolve(__dirname, 'results');

mkdirSync(RESULTS_DIR, { recursive: true });

/**
 * 计算单条查询的检索指标
 */
function computeQueryMetrics(retrievedIds, relevantIds) {
  const retrievedSet = new Set(retrievedIds);
  const relevantSet = new Set(relevantIds);

  // 过滤掉占位符 TODO_FILL_DOC_ID
  const validRelevantIds = relevantIds.filter(id => !id.startsWith('TODO'));
  if (validRelevantIds.length === 0) {
    return null; // 跳过未填写文档 ID 的条目
  }

  const hits = validRelevantIds.filter(id => retrievedSet.has(id));
  const hitCount = hits.length;

  // Recall@K: 命中的相关文档数 / 总相关文档数
  const recall = validRelevantIds.length > 0 ? hitCount / validRelevantIds.length : 0;

  // Precision@K: 命中的相关文档数 / 检索返回的文档总数
  const precision = retrievedIds.length > 0 ? hitCount / retrievedIds.length : 0;

  // MRR: 第一个相关结果排名的倒数
  let reciprocalRank = 0;
  for (let i = 0; i < retrievedIds.length; i++) {
    if (validRelevantIds.includes(retrievedIds[i])) {
      reciprocalRank = 1 / (i + 1);
      break;
    }
  }

  // Hit Rate: 是否至少命中一个相关文档
  const hitRate = hitCount > 0 ? 1 : 0;

  return { recall, precision, reciprocalRank, hitRate, hitCount, totalRelevant: validRelevantIds.length, totalRetrieved: retrievedIds.length };
}

/**
 * 计算 Recall@K (K = 1, 3, 5)
 */
function computeRecallAtK(allResults) {
  const ks = [1, 3, 5];
  const recallAtK = {};

  for (const k of ks) {
    let totalRecall = 0;
    let count = 0;

    for (const result of allResults) {
      if (!result.metrics) continue;
      const relevantSet = new Set(result.groundTruthDocIds.filter(id => !id.startsWith('TODO')));
      if (relevantSet.size === 0) continue;

      const topK = result.retrievedIds.slice(0, k);
      const hits = topK.filter(id => relevantSet.has(id)).length;
      totalRecall += hits / relevantSet.size;
      count++;
    }

    recallAtK[`recall@${k}`] = count > 0 ? totalRecall / count : 0;
  }

  return recallAtK;
}

/**
 * 运行检索质量评测
 */
export async function runRetrievalEval(options = {}) {
  const { sampleSize = 0, verbose = true } = options;

  console.log('\n========================================');
  console.log('  RAG 检索质量评测');
  console.log('========================================\n');

  // 检查后端
  const healthy = await checkBackendHealth();
  if (!healthy) {
    console.error('❌ 后端服务不可用，请先启动后端: cd backend && npm run dev');
    return null;
  }
  console.log('✅ 后端服务正常\n');

  // 加载评测集
  const dataset = JSON.parse(readFileSync(DATASET_PATH, 'utf-8'));
  const testSet = sampleSize > 0 ? dataset.slice(0, sampleSize) : dataset;
  console.log(`📋 评测集: ${testSet.length} 条（共 ${dataset.length} 条）\n`);

  const results = [];
  let skipped = 0;

  for (let i = 0; i < testSet.length; i++) {
    const item = testSet[i];
    const progress = `[${i + 1}/${testSet.length}]`;

    // 过滤占位符
    const validRelevantIds = item.relevant_doc_ids.filter(id => !id.startsWith('TODO'));
    if (validRelevantIds.length === 0) {
      if (verbose) console.log(`${progress} ⏭️  ${item.id}: ${item.question.substring(0, 30)}... (未填写文档ID，跳过)`);
      skipped++;
      continue;
    }

    try {
      if (verbose) process.stdout.write(`${progress} 🔍 ${item.id}: ${item.question.substring(0, 40)}...`);

      const { answer, sources } = await withRetry(() => ragQuery(item.question));

      // 提取检索到的文档 ID
      const retrievedIds = sources.map(s => s.id).filter(Boolean);

      const metrics = computeQueryMetrics(retrievedIds, item.relevant_doc_ids);

      results.push({
        id: item.id,
        question: item.question,
        category: item.category,
        difficulty: item.difficulty,
        groundTruthDocIds: item.relevant_doc_ids,
        retrievedIds,
        metrics,
        answer: answer.substring(0, 200) // 只保留前 200 字用于报告
      });

      if (verbose) {
        const status = metrics && metrics.hitRate ? '✅' : '❌';
        const recall = metrics ? (metrics.recall * 100).toFixed(0) : 'N/A';
        console.log(` ${status} recall=${recall}%`);
      }
    } catch (err) {
      console.error(` ❌ 错误: ${err.message}`);
      results.push({
        id: item.id,
        question: item.question,
        category: item.category,
        difficulty: item.difficulty,
        groundTruthDocIds: item.relevant_doc_ids,
        retrievedIds: [],
        metrics: null,
        error: err.message
      });
    }
  }

  // 汇总统计
  const validResults = results.filter(r => r.metrics !== null);
  if (validResults.length === 0) {
    console.log('\n⚠️  没有有效的评测结果（所有条目都缺少文档 ID）');
    console.log('   请先编辑 dataset/campus-qa.json，将 TODO_FILL_DOC_ID 替换为实际的文档 ID');
    console.log('   获取方式: GET http://localhost:3000/api/rag/documents');
    return null;
  }

  const avgRecall = validResults.reduce((s, r) => s + r.metrics.recall, 0) / validResults.length;
  const avgPrecision = validResults.reduce((s, r) => s + r.metrics.precision, 0) / validResults.length;
  const avgMRR = validResults.reduce((s, r) => s + r.metrics.reciprocalRank, 0) / validResults.length;
  const hitRate = validResults.filter(r => r.metrics.hitRate > 0).length / validResults.length;
  const recallAtK = computeRecallAtK(results);

  // 按类别统计
  const byCategory = {};
  for (const r of validResults) {
    if (!byCategory[r.category]) byCategory[r.category] = { count: 0, recall: 0, precision: 0, mrr: 0 };
    byCategory[r.category].count++;
    byCategory[r.category].recall += r.metrics.recall;
    byCategory[r.category].precision += r.metrics.precision;
    byCategory[r.category].mrr += r.metrics.reciprocalRank;
  }
  for (const [cat, stats] of Object.entries(byCategory)) {
    stats.recall = (stats.recall / stats.count * 100).toFixed(1) + '%';
    stats.precision = (stats.precision / stats.count * 100).toFixed(1) + '%';
    stats.mrr = (stats.mrr / stats.count).toFixed(3);
  }

  // 按难度统计
  const byDifficulty = {};
  for (const r of validResults) {
    if (!byDifficulty[r.difficulty]) byDifficulty[r.difficulty] = { count: 0, recall: 0, hitRate: 0 };
    byDifficulty[r.difficulty].count++;
    byDifficulty[r.difficulty].recall += r.metrics.recall;
    byDifficulty[r.difficulty].hitRate += r.metrics.hitRate;
  }
  for (const [diff, stats] of Object.entries(byDifficulty)) {
    stats.recall = (stats.recall / stats.count * 100).toFixed(1) + '%';
    stats.hitRate = (stats.hitRate / stats.count * 100).toFixed(1) + '%';
  }

  const summary = {
    total: testSet.length,
    evaluated: validResults.length,
    skipped,
    overall: {
      recall: (avgRecall * 100).toFixed(1) + '%',
      precision: (avgPrecision * 100).toFixed(1) + '%',
      mrr: avgMRR.toFixed(3),
      hitRate: (hitRate * 100).toFixed(1) + '%',
      ...Object.fromEntries(Object.entries(recallAtK).map(([k, v]) => [k, (v * 100).toFixed(1) + '%']))
    },
    byCategory,
    byDifficulty
  };

  // 输出结果
  console.log('\n\n📊 检索质量评测结果');
  console.log('─────────────────────────────────');
  console.log(`  有效样本: ${validResults.length} / ${testSet.length}`);
  console.log(`  跳过(无文档ID): ${skipped}`);
  console.log(`  错误: ${results.filter(r => r.error).length}`);
  console.log('─────────────────────────────────');
  console.log('  整体指标:');
  console.log(`    Recall:     ${summary.overall.recall}`);
  console.log(`    Precision:  ${summary.overall.precision}`);
  console.log(`    MRR:        ${summary.overall.mrr}`);
  console.log(`    Hit Rate:   ${summary.overall.hitRate}`);
  for (const [k, v] of Object.entries(recallAtK)) {
    console.log(`    ${k}: ${(v * 100).toFixed(1)}%`);
  }
  console.log('─────────────────────────────────');
  console.log('  按类别:');
  for (const [cat, stats] of Object.entries(byCategory)) {
    console.log(`    ${cat}: recall=${stats.recall} precision=${stats.precision} mrr=${stats.mrr} (n=${stats.count})`);
  }
  console.log('─────────────────────────────────');
  console.log('  按难度:');
  for (const [diff, stats] of Object.entries(byDifficulty)) {
    console.log(`    ${diff}: recall=${stats.recall} hitRate=${stats.hitRate} (n=${stats.count})`);
  }

  // 保存结果
  const output = { summary, results, timestamp: new Date().toISOString() };
  const outputPath = resolve(RESULTS_DIR, 'retrieval-results.json');
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n💾 结果已保存: ${outputPath}`);

  return output;
}

// 直接运行
if (process.argv[1] && process.argv[1].includes('eval-retrieval')) {
  runRetrievalEval().catch(console.error);
}
