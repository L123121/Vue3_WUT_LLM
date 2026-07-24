/**
 * 父段重排离线评估
 *
 * 输入：collect-parent-rerank-eval.js 生成并人工标注后的 JSON。
 * 指标：Recall@10（至少一个相关父段是否进入 Top10）、MRR、第一个相关父段平均排名。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, 'results');
const INPUT_PATH = resolve(RESULTS_DIR, 'parent-rerank-annotations.json');
const OUTPUT_PATH = resolve(RESULTS_DIR, 'parent-rerank-metrics.json');

mkdirSync(RESULTS_DIR, { recursive: true });

function parseArgs(argv) {
  const options = {
    input: INPUT_PATH,
    output: OUTPUT_PATH,
    topK: 10,
    allowPartial: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split('=');
    const nextValue = inlineValue ?? argv[index + 1];

    if (key === '--input') options.input = resolve(__dirname, nextValue);
    if (key === '--output') options.output = resolve(__dirname, nextValue);
    if (key === '--top-k') options.topK = parseInt(nextValue, 10) || options.topK;
    if (key === '--allow-partial') options.allowPartial = true;

    if (!inlineValue && key !== '--allow-partial' && key.startsWith('--')) index++;
  }

  return options;
}

function normalizeLabel(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'relevant', '相关'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0', 'irrelevant', '不相关'].includes(normalized)) return false;
  return null;
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isQueryLabeled(query, allowPartial) {
  const candidates = query.candidates || [];
  if (!candidates.length) return false;
  if (allowPartial) return candidates.some(candidate => normalizeLabel(candidate.isRelevant) !== null);
  return candidates.every(candidate => normalizeLabel(candidate.isRelevant) !== null);
}

function evaluateQuery(query, topK) {
  const candidates = (query.candidates || []).map((candidate, index) => ({
    ...candidate,
    rank: candidate.rank || index + 1,
    normalizedLabel: normalizeLabel(candidate.isRelevant),
  }));
  const relevantCandidates = candidates.filter(candidate => candidate.normalizedLabel === true);
  const relevantRanks = relevantCandidates.map(candidate => candidate.rank).sort((a, b) => a - b);
  const topKRelevant = relevantRanks.filter(rank => rank <= topK);
  const firstRelevantRank = relevantRanks[0] || null;

  return {
    id: query.id,
    question: query.question,
    category: query.category,
    difficulty: query.difficulty,
    candidateCount: candidates.length,
    relevantCount: relevantRanks.length,
    relevantInTopK: topKRelevant.length,
    hitAtTopK: topKRelevant.length > 0 ? 1 : 0,
    firstRelevantRank,
    reciprocalRank: firstRelevantRank ? 1 / firstRelevantRank : 0,
    relevantParentIds: relevantCandidates.map(candidate => candidate.parentId),
    firstRelevantParentId: firstRelevantRank
      ? relevantCandidates.find(candidate => candidate.rank === firstRelevantRank)?.parentId || null
      : null,
  };
}

function buildRecommendation(summary) {
  const mrr = summary.overall.mrrValue;
  const avgRank = summary.overall.averageFirstRelevantRankValue;
  const recallAt10 = summary.overall.recallAtTopKValue;

  if (summary.evaluated === 0) return '没有可评估样本，请先完成人工标注。';
  if (recallAt10 >= 0.95 && mrr >= 0.5 && avgRank > 0 && avgRank <= 2) {
    return 'MRR 已较高，首个相关父段平均在第 2 位以内，精排模型预期收益较小，可以先跳过。';
  }
  if (mrr <= 0.25 || avgRank >= 5) {
    return 'MRR 偏低或首个相关父段平均排名靠后，精排模型有机会把相关父段推到第 1 位，建议继续验证。';
  }
  return '排序质量处于中间区间，建议先对 ranking_error Query 做小规模精排 A/B，再决定是否上线。';
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = JSON.parse(readFileSync(options.input, 'utf-8'));
  const queries = input.queries || [];
  const labeledQueries = queries.filter(query => isQueryLabeled(query, options.allowPartial));
  const skippedQueries = queries.filter(query => !isQueryLabeled(query, options.allowPartial));
  const queryResults = labeledQueries.map(query => evaluateQuery(query, options.topK));

  const evaluated = queryResults.length;
  const hitAtTopK = queryResults.reduce((sum, result) => sum + result.hitAtTopK, 0);
  const reciprocalRanks = queryResults.map(result => result.reciprocalRank);
  const firstRanks = queryResults.map(result => result.firstRelevantRank).filter(Boolean);
  const totalRelevant = queryResults.reduce((sum, result) => sum + result.relevantCount, 0);
  const totalRelevantInTopK = queryResults.reduce((sum, result) => sum + result.relevantInTopK, 0);
  const noRelevantInPool = queryResults.filter(result => result.relevantCount === 0);
  const rankingErrors = queryResults.filter(result => result.firstRelevantRank && result.firstRelevantRank > 3);

  const recallAtTopKValue = evaluated ? hitAtTopK / evaluated : 0;
  const parentRecallAtTopKValue = totalRelevant ? totalRelevantInTopK / totalRelevant : 0;
  const mrrValue = average(reciprocalRanks);
  const averageFirstRelevantRankValue = average(firstRanks);

  const summary = {
    total: queries.length,
    evaluated,
    skippedUnlabeled: skippedQueries.length,
    topK: options.topK,
    overall: {
      recallAtTopK: percent(recallAtTopKValue),
      recallAtTopKValue,
      parentRecallAtTopK: percent(parentRecallAtTopKValue),
      parentRecallAtTopKValue,
      mrr: mrrValue.toFixed(3),
      mrrValue,
      averageFirstRelevantRank: averageFirstRelevantRankValue ? averageFirstRelevantRankValue.toFixed(2) : 'N/A',
      averageFirstRelevantRankValue,
      foundRelevantQueries: firstRanks.length,
      noRelevantInPool: noRelevantInPool.length,
      rankingErrorCount: rankingErrors.length,
    },
  };
  summary.recommendation = buildRecommendation(summary);

  const output = {
    version: 1,
    task: 'parent-rerank-offline-eval',
    evaluatedAt: new Date().toISOString(),
    input: options.input,
    summary,
    queryResults,
    rankingErrors,
    noRelevantInPool,
    skippedQueries: skippedQueries.map(query => ({
      id: query.id,
      question: query.question,
      reason: '候选父段尚未全部标注 isRelevant=true/false',
    })),
  };

  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, JSON.stringify(output, null, 2), 'utf-8');

  console.log('\n========================================');
  console.log('  父段重排离线评估结果');
  console.log('========================================');
  console.log(`有效样本: ${summary.evaluated} / ${summary.total}`);
  console.log(`跳过未完整标注: ${summary.skippedUnlabeled}`);
  console.log(`Recall@${options.topK}: ${summary.overall.recallAtTopK}`);
  console.log(`相关父段级 Recall@${options.topK}: ${summary.overall.parentRecallAtTopK}`);
  console.log(`MRR: ${summary.overall.mrr}`);
  console.log(`第一个相关父段平均排名: ${summary.overall.averageFirstRelevantRank}`);
  console.log(`Top25 内无相关父段: ${summary.overall.noRelevantInPool}`);
  console.log(`排序错误(首个相关 > 3): ${summary.overall.rankingErrorCount}`);
  console.log(`结论: ${summary.recommendation}`);
  console.log(`\n💾 结果已保存: ${options.output}`);
}

main();
