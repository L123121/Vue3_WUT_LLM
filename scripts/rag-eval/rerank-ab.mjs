/**
 * rerank-ab — rerank 阈值 A/B 对比评测（配合请求级阈值覆盖）
 *
 * 用法（在 scripts/rag-eval 目录下，需后端已启动 + RAG_EVAL_COOKIE）：
 *
 *   # 组 A = 生产默认（不传覆盖参数）；组 B = 覆盖阈值
 *   AB_B_RERANK_MIN_SCORE=0.40 AB_B_RERANK_DROPOFF=0.08 \
 *   AB_B_RERANK_TOP_K=6 AB_B_MAX_CONTEXT_LENGTH=4000 \
 *   node rerank-ab.mjs
 *
 *   # 也可自定义组 A（默认 A 为空覆盖 = 生产配置）
 *   AB_A_RERANK_MIN_SCORE=0.30 node rerank-ab.mjs
 *
 *   # 指定数据集 / 抽样
 *   DATASET_PATH=dataset/full-coverage-qa.json AB_SAMPLE=8 node rerank-ab.mjs
 *
 * 输出：两组 Recall / Precision / MRR / nDCG@5 / HitRate 对比表 + 按类别对比
 *       （命中同一套指标计算，与 eval-retrieval.js 口径一致）
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ragQuery, withRetry, checkBackendHealth } from './utils/api-client.js';
import { computeQueryMetrics, classifyBadCase, averageMetric, percent, EVAL_KS, getValidRelevantIds } from './eval-retrieval.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = process.env.DATASET_PATH
  ? resolve(__dirname, process.env.DATASET_PATH)
  : resolve(__dirname, 'dataset/full-coverage-qa.json');
const RESULTS_DIR = resolve(__dirname, 'results');
const SAMPLE_SIZE = parseInt(process.env.AB_SAMPLE, 10) || 0;

/**
 * 从环境变量读取一组覆盖参数（AB_A_* / AB_B_* 前缀）
 */
function readOverridesFromEnv(prefix) {
  const overrides = {};
  const map = {
    [`${prefix}_RERANK_MIN_SCORE`]: 'rerankMinScore',
    [`${prefix}_RERANK_DROPOFF`]: 'rerankDropoff',
    [`${prefix}_RERANK_TOP_K`]: 'rerankTopK',
    [`${prefix}_MAX_CONTEXT_LENGTH`]: 'maxContextLength',
  };
  for (const [envKey, optKey] of Object.entries(map)) {
    const v = process.env[envKey];
    if (v !== undefined && v !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) overrides[optKey] = n;
    }
  }
  return overrides;
}

/**
 * 用指定覆盖参数跑一遍完整评测
 * @returns {Promise<{name, overrides, results, overall, byCategory}>}
 */
async function runGroup(name, overrides) {
  console.log(`\n▶ 运行组 ${name}${Object.keys(overrides).length ? ` 覆盖=${JSON.stringify(overrides)}` : '（生产默认）'}`);

  const dataset = JSON.parse(readFileSync(DATASET_PATH, 'utf-8'));
  const testSet = SAMPLE_SIZE > 0 ? dataset.slice(0, SAMPLE_SIZE) : dataset;

  const results = [];
  let skipped = 0;
  for (let index = 0; index < testSet.length; index++) {
    const item = testSet[index];
    const progress = `[${index + 1}/${testSet.length}]`;
    const validRelevantIds = getValidRelevantIds(item.relevant_doc_ids);
    if (validRelevantIds.length === 0) {
      skipped++;
      continue;
    }
    try {
      process.stdout.write(`${progress} 🔍 ${item.id}: ${item.question.substring(0, 30)}...`);
      const { answer, sources } = await withRetry(() => ragQuery(item.question, [], { category: item.category, ...overrides }));
      const retrievedIds = sources.map((s) => s.id).filter(Boolean);
      const metrics = computeQueryMetrics(retrievedIds, item.relevant_doc_ids);
      const badCase = classifyBadCase({ metrics, retrievedIds, answer });
      results.push({ id: item.id, question: item.question, category: item.category, metrics, badCase });
      console.log(` ${badCase.type === 'pass' ? '✅' : '⚠️'} recall=${percent(metrics.recall)}`);
    } catch (err) {
      console.error(` ❌ ${err.message}`);
      results.push({ id: item.id, category: item.category, metrics: null, badCase: classifyBadCase({ error: err.message, retrievedIds: [], answer: '' }) });
    }
  }

  const validResults = results.filter((r) => r.metrics !== null);
  const overall = {
    recall: percent(averageMetric(validResults, 'recall')),
    precision: percent(averageMetric(validResults, 'precision')),
    mrr: averageMetric(validResults, 'reciprocalRank').toFixed(3),
    hitRate: percent(averageMetric(validResults, 'hitRate')),
    ...Object.fromEntries(EVAL_KS.map((k) => [`recall@${k}`, percent(averageMetric(validResults, `recall@${k}`))])),
    ...Object.fromEntries(EVAL_KS.map((k) => [`ndcg@${k}`, averageMetric(validResults, `ndcg@${k}`).toFixed(3)])),
  };

  // 按类别汇总
  const byCategory = {};
  for (const r of validResults) {
    const key = r.category || 'unknown';
    if (!byCategory[key]) byCategory[key] = { count: 0, recall: 0, mrr: 0, ndcg5: 0, hitRate: 0 };
    byCategory[key].count++;
    byCategory[key].recall += r.metrics.recall;
    byCategory[key].mrr += r.metrics.reciprocalRank;
    byCategory[key].ndcg5 += r.metrics['ndcg@5'];
    byCategory[key].hitRate += r.metrics.hitRate;
  }
  for (const s of Object.values(byCategory)) {
    s.recall = percent(s.recall / s.count);
    s.mrr = (s.mrr / s.count).toFixed(3);
    s.ndcg5 = (s.ndcg5 / s.count).toFixed(3);
    s.hitRate = percent(s.hitRate / s.count);
  }

  console.log(`  组 ${name}: Recall=${overall.recall} Precision=${overall.precision} MRR=${overall.mrr} nDCG@5=${overall['ndcg@5']} HitRate=${overall.hitRate}（有效 ${validResults.length}/${testSet.length}）`);
  return { name, overrides, results, overall, byCategory, evaluated: validResults.length, skipped };
}

async function main() {
  console.log('========================================');
  console.log('  rerank 阈值 A/B 对比评测（请求级覆盖）');
  console.log('========================================');

  const healthy = await checkBackendHealth();
  if (!healthy) {
    console.error('❌ 后端服务不可用，请先启动后端: cd backend && npm run dev');
    process.exit(1);
  }
  console.log('✅ 后端服务正常\n');

  const groupA = await runGroup('A', readOverridesFromEnv('AB_A'));
  const groupB = await runGroup('B', readOverridesFromEnv('AB_B'));

  // 对比表
  console.log('\n\n📊 A/B 对比结果');
  console.log('──────────────────────────────────────────────────────────');
  console.log(`  数据集: ${DATASET_PATH.split('/').pop()}（每组 ${groupA.evaluated} 题）`);
  console.log(`  组 A 覆盖: ${JSON.stringify(groupA.overrides) || '生产默认'}`);
  console.log(`  组 B 覆盖: ${JSON.stringify(groupB.overrides) || '生产默认'}`);
  console.log('──────────────────────────────────────────────────────────');
  const rows = [
    ['Recall', groupA.overall.recall, groupB.overall.recall],
    ['Precision', groupA.overall.precision, groupB.overall.precision],
    ['MRR', groupA.overall.mrr, groupB.overall.mrr],
    ['nDCG@5', groupA.overall['ndcg@5'], groupB.overall['ndcg@5']],
    ['HitRate', groupA.overall.hitRate, groupB.overall.hitRate],
    ['recall@1', groupA.overall['recall@1'], groupB.overall['recall@1']],
    ['recall@3', groupA.overall['recall@3'], groupB.overall['recall@3']],
    ['recall@5', groupA.overall['recall@5'], groupB.overall['recall@5']],
  ];
  console.log('  指标          | 组 A        | 组 B        | 差值');
  console.log('  ------------ | ----------- | ----------- | ---------');
  for (const [label, a, b] of rows) {
    const delta = `${a} → ${b}`;
    const mark = a === b ? '' : (parseFloat(b) >= parseFloat(a) ? ' ↑' : ' ↓');
    console.log(`  ${label.padEnd(13)} | ${String(a).padEnd(11)} | ${String(b).padEnd(11)} | ${delta}${mark}`);
  }

  // 按类别对比
  const allCategories = new Set([...Object.keys(groupA.byCategory), ...Object.keys(groupB.byCategory)]);
  if (allCategories.size > 0) {
    console.log('\n  按类别 recall:');
    for (const cat of allCategories) {
      const a = groupA.byCategory[cat] || { recall: '-', count: 0 };
      const b = groupB.byCategory[cat] || { recall: '-', count: 0 };
      console.log(`    ${cat.padEnd(12)} A=${a.recall} (n=${a.count})  B=${b.recall} (n=${b.count})`);
    }
  }

  // 保存结果
  mkdirSync(RESULTS_DIR, { recursive: true });
  const outputPath = resolve(RESULTS_DIR, `rerank-ab-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  writeFileSync(outputPath, JSON.stringify({ groupA, groupB, timestamp: new Date().toISOString() }, null, 2));
  console.log(`\n💾 结果已保存: ${outputPath}`);
}

main().catch((err) => {
  console.error('A/B 评测失败:', err);
  process.exit(1);
});
