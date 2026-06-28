/**
 * RAGAS 生成质量评测
 * 指标：Faithfulness, Answer Relevancy, Context Precision, Context Recall
 *
 * 由于 RAGAS 官方库是 Python，本文件在 Node.js 中重新实现
 * 核心逻辑：prompt 模板 + LLM 调用 + 分数解析
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ragQuery, getDocument, withRetry, checkBackendHealth } from './utils/api-client.js';
import { computeAllMetrics } from './utils/ragas-metrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = resolve(__dirname, 'dataset/campus-qa.json');
const RESULTS_DIR = resolve(__dirname, 'results');

mkdirSync(RESULTS_DIR, { recursive: true });

/**
 * 从 fileRefer 和文档内容中提取上下文片段
 * @param {Array} sources - RAG 返回的 sources (含 id 和 chunks 索引)
 * @returns {Promise<string[]>} 上下文片段数组
 */
async function extractContexts(sources) {
  const contexts = [];

  for (const source of sources) {
    if (!source.id) continue;

    try {
      const doc = await getDocument(source.id);
      if (!doc || !doc.content) continue;

      // 如果有 chunk 索引，按索引切片
      if (source.chunks && source.chunks.length > 0) {
        const content = doc.content;
        const chunkSize = 500; // 与 TextSplitter 的 chunkSize 一致
        const chunkOverlap = 50;

        for (const chunkIndex of source.chunks) {
          const start = Math.max(0, chunkIndex * (chunkSize - chunkOverlap));
          const end = Math.min(content.length, start + chunkSize);
          const chunk = content.substring(start, end).trim();
          if (chunk) contexts.push(chunk);
        }
      } else {
        // 没有 chunk 索引，使用文档摘要（前 1000 字）
        contexts.push(doc.content.substring(0, 1000));
      }
    } catch (err) {
      console.warn(`  [RAGAS] 获取文档 ${source.id} 失败: ${err.message}`);
    }
  }

  // 去重
  return [...new Set(contexts)];
}

/**
 * 运行 RAGAS 评测
 */
export async function runRagasEval(options = {}) {
  const { sampleSize = 0, verbose = true } = options;

  console.log('\n========================================');
  console.log('  RAGAS 生成质量评测');
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

    // 跳过没有标准答案的条目
    if (!item.ground_truth || item.ground_truth.trim() === '') {
      if (verbose) console.log(`${progress} ⏭️  ${item.id}: 无标准答案，跳过`);
      skipped++;
      continue;
    }

    try {
      if (verbose) process.stdout.write(`${progress} 🤖 ${item.id}: ${item.question.substring(0, 40)}...`);

      // 1. 调用 RAG 接口获取回答和来源
      const { answer, sources } = await withRetry(() => ragQuery(item.question));

      // 2. 提取上下文片段
      const contexts = await extractContexts(sources);

      if (contexts.length === 0) {
        if (verbose) console.log(' ⚠️ 无上下文');
        results.push({
          id: item.id,
          question: item.question,
          category: item.category,
          difficulty: item.difficulty,
          answer: answer.substring(0, 200),
          contexts: [],
          metrics: null,
          warning: '无检索上下文'
        });
        continue;
      }

      // 3. 计算 RAGAS 指标
      if (verbose) process.stdout.write(' → 评分中...');
      const metrics = await withRetry(() => computeAllMetrics({
        question: item.question,
        answer,
        contexts,
        groundTruth: item.ground_truth
      }), 2, 3000);

      results.push({
        id: item.id,
        question: item.question,
        category: item.category,
        difficulty: item.difficulty,
        ground_truth: item.ground_truth,
        answer: answer.substring(0, 200),
        contexts: contexts.map(c => c.substring(0, 200)),
        metrics: {
          faithfulness: metrics.faithfulness.score,
          answer_relevancy: metrics.answer_relevancy.score,
          context_precision: metrics.context_precision.score,
          context_recall: metrics.context_recall.score,
          overall: metrics.overall
        },
        metricsDetail: {
          faithfulness: metrics.faithfulness.detail,
          answer_relevancy: metrics.answer_relevancy.detail,
          context_precision: metrics.context_precision.detail,
          context_recall: metrics.context_recall.detail
        }
      });

      if (verbose) {
        const f = (metrics.faithfulness.score * 100).toFixed(0);
        const a = (metrics.answer_relevancy.score * 100).toFixed(0);
        const cp = (metrics.context_precision.score * 100).toFixed(0);
        const cr = (metrics.context_recall.score * 100).toFixed(0);
        console.log(` ✅ F=${f}% A=${a}% CP=${cp}% CR=${cr}%`);
      }
    } catch (err) {
      console.error(` ❌ 错误: ${err.message}`);
      results.push({
        id: item.id,
        question: item.question,
        category: item.category,
        difficulty: item.difficulty,
        metrics: null,
        error: err.message
      });
    }
  }

  // 汇总统计
  const validResults = results.filter(r => r.metrics !== null);
  if (validResults.length === 0) {
    console.log('\n⚠️  没有有效的评测结果');
    return null;
  }

  const avg = (arr, key) => arr.reduce((s, r) => s + r.metrics[key], 0) / arr.length;

  const overall = {
    faithfulness: avg(validResults, 'faithfulness'),
    answer_relevancy: avg(validResults, 'answer_relevancy'),
    context_precision: avg(validResults, 'context_precision'),
    context_recall: avg(validResults, 'context_recall'),
    overall: avg(validResults, 'overall')
  };

  // 按类别统计
  const byCategory = {};
  for (const r of validResults) {
    if (!byCategory[r.category]) byCategory[r.category] = { count: 0, scores: [] };
    byCategory[r.category].count++;
    byCategory[r.category].scores.push(r.metrics);
  }
  for (const [cat, stats] of Object.entries(byCategory)) {
    const n = stats.count;
    stats.avg = {
      faithfulness: (stats.scores.reduce((s, m) => s + m.faithfulness, 0) / n * 100).toFixed(1) + '%',
      answer_relevancy: (stats.scores.reduce((s, m) => s + m.answer_relevancy, 0) / n * 100).toFixed(1) + '%',
      context_precision: (stats.scores.reduce((s, m) => s + m.context_precision, 0) / n * 100).toFixed(1) + '%',
      context_recall: (stats.scores.reduce((s, m) => s + m.context_recall, 0) / n * 100).toFixed(1) + '%'
    };
    delete stats.scores;
  }

  // 按难度统计
  const byDifficulty = {};
  for (const r of validResults) {
    if (!byDifficulty[r.difficulty]) byDifficulty[r.difficulty] = { count: 0, scores: [] };
    byDifficulty[r.difficulty].count++;
    byDifficulty[r.difficulty].scores.push(r.metrics);
  }
  for (const [diff, stats] of Object.entries(byDifficulty)) {
    const n = stats.count;
    stats.avg = {
      overall: (stats.scores.reduce((s, m) => s + m.overall, 0) / n * 100).toFixed(1) + '%',
      faithfulness: (stats.scores.reduce((s, m) => s + m.faithfulness, 0) / n * 100).toFixed(1) + '%',
      answer_relevancy: (stats.scores.reduce((s, m) => s + m.answer_relevancy, 0) / n * 100).toFixed(1) + '%'
    };
    delete stats.scores;
  }

  const summary = {
    total: testSet.length,
    evaluated: validResults.length,
    skipped,
    warnings: results.filter(r => r.warning).length,
    errors: results.filter(r => r.error).length,
    overall: {
      faithfulness: (overall.faithfulness * 100).toFixed(1) + '%',
      answer_relevancy: (overall.answer_relevancy * 100).toFixed(1) + '%',
      context_precision: (overall.context_precision * 100).toFixed(1) + '%',
      context_recall: (overall.context_recall * 100).toFixed(1) + '%',
      overall: (overall.overall * 100).toFixed(1) + '%'
    },
    byCategory,
    byDifficulty
  };

  // 输出结果
  console.log('\n\n📊 RAGAS 生成质量评测结果');
  console.log('─────────────────────────────────');
  console.log(`  有效样本: ${validResults.length} / ${testSet.length}`);
  console.log(`  警告(无上下文): ${summary.warnings}`);
  console.log(`  错误: ${summary.errors}`);
  console.log('─────────────────────────────────');
  console.log('  整体指标:');
  console.log(`    Faithfulness:       ${summary.overall.faithfulness}`);
  console.log(`    Answer Relevancy:   ${summary.overall.answer_relevancy}`);
  console.log(`    Context Precision:  ${summary.overall.context_precision}`);
  console.log(`    Context Recall:     ${summary.overall.context_recall}`);
  console.log(`    Overall:            ${summary.overall.overall}`);
  console.log('─────────────────────────────────');
  console.log('  按类别:');
  for (const [cat, stats] of Object.entries(byCategory)) {
    console.log(`    ${cat}: F=${stats.avg.faithfulness} A=${stats.avg.answer_relevancy} CP=${stats.avg.context_precision} CR=${stats.avg.context_recall} (n=${stats.count})`);
  }
  console.log('─────────────────────────────────');
  console.log('  按难度:');
  for (const [diff, stats] of Object.entries(byDifficulty)) {
    console.log(`    ${diff}: overall=${stats.avg.overall} F=${stats.avg.faithfulness} A=${stats.avg.answer_relevancy} (n=${stats.count})`);
  }

  // 保存结果
  const output = { summary, results, timestamp: new Date().toISOString() };
  const outputPath = resolve(RESULTS_DIR, 'ragas-results.json');
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n💾 结果已保存: ${outputPath}`);

  return output;
}

// 直接运行
if (process.argv[1] && process.argv[1].includes('eval-ragas')) {
  runRagasEval().catch(console.error);
}
