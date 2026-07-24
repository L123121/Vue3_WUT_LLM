/**
 * 采集父段重排离线评估样本
 *
 * 流程：读取真实 Query 数据集 → 检索 Top25 子句 → 聚合父段列表 → 输出待人工标注 JSON。
 * 人工标注时，将每个 candidates[].isRelevant 从 null 改为 true / false。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { checkBackendHealth, retrieveParentCandidates, withRetry } from './utils/api-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = resolve(__dirname, 'dataset/campus-qa.json');
const RESULTS_DIR = resolve(__dirname, 'results');
const OUTPUT_PATH = resolve(RESULTS_DIR, 'parent-rerank-annotations.json');

mkdirSync(RESULTS_DIR, { recursive: true });

function parseArgs(argv) {
  const options = {
    dataset: DATASET_PATH,
    output: OUTPUT_PATH,
    sampleSize: 50,
    childTopK: 25,
    parentTopK: 0,
    category: '',
    includeChildren: true,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split('=');
    const nextValue = inlineValue ?? argv[index + 1];

    if (key === '--dataset') options.dataset = resolve(__dirname, nextValue);
    if (key === '--output') options.output = resolve(__dirname, nextValue);
    if (key === '--sample-size') options.sampleSize = parseInt(nextValue, 10) || options.sampleSize;
    if (key === '--child-top-k') options.childTopK = parseInt(nextValue, 10) || options.childTopK;
    if (key === '--parent-top-k') options.parentTopK = parseInt(nextValue, 10) || options.parentTopK;
    if (key === '--category') options.category = nextValue || '';
    if (key === '--no-children') options.includeChildren = false;

    if (!inlineValue && key !== '--no-children' && key.startsWith('--')) index++;
  }

  return options;
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function labelKey(queryId, parentId) {
  return `${queryId}::${parentId}`;
}

function loadExistingLabels(path) {
  if (!existsSync(path)) return new Map();
  const existing = loadJson(path);
  const labels = new Map();

  for (const query of existing.queries || []) {
    for (const candidate of query.candidates || []) {
      if (typeof candidate.isRelevant !== 'boolean') continue;
      labels.set(labelKey(query.id || query.question, candidate.parentId), {
        isRelevant: candidate.isRelevant,
        note: candidate.note || '',
      });
    }
  }

  return labels;
}

function buildCandidate(parent, queryId, existingLabels) {
  const saved = existingLabels.get(labelKey(queryId, parent.parentId));
  return {
    rank: parent.rank,
    parentId: parent.parentId,
    docId: parent.docId,
    title: parent.title,
    category: parent.category,
    parentIdx: parent.parentIdx,
    parentText: parent.parentText,
    matchedScore: parent.matchedScore,
    vectorScore: parent.vectorScore,
    sparseScore: parent.sparseScore,
    hybridScore: parent.hybridScore,
    keywordScore: parent.keywordScore,
    matchedChunks: parent.matchedChunks,
    matchedChunkIds: parent.matchedChunkIds,
    firstChildRank: parent.firstChildRank,
    bestChildRank: parent.bestChildRank,
    retrievalChannels: parent.retrievalChannels,
    isRelevant: saved?.isRelevant ?? null,
    note: saved?.note || '',
    children: parent.children,
  };
}

function selectQueries(dataset, options) {
  const filtered = dataset.filter(item => {
    if (!item.question) return false;
    if (options.category && item.category !== options.category) return false;
    return true;
  });

  return filtered.slice(0, options.sampleSize);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const healthy = await checkBackendHealth();
  if (!healthy) {
    throw new Error('后端服务不可用，请先启动后端并确认 BACKEND_URL 正确');
  }

  const dataset = loadJson(options.dataset);
  const queries = selectQueries(dataset, options);
  const existingLabels = loadExistingLabels(options.output);

  if (queries.length < options.sampleSize) {
    console.warn(`⚠️  当前数据集仅选出 ${queries.length} 条 Query，少于目标 ${options.sampleSize} 条`);
  }

  console.log('\n========================================');
  console.log('  父段重排离线评估样本采集');
  console.log('========================================');
  console.log(`数据集: ${options.dataset}`);
  console.log(`样本数: ${queries.length}`);
  console.log(`子句召回: Top${options.childTopK}`);
  console.log(`输出: ${options.output}\n`);

  const outputQueries = [];

  for (let index = 0; index < queries.length; index++) {
    const item = queries[index];
    const progress = `[${index + 1}/${queries.length}]`;
    process.stdout.write(`${progress} 🔍 ${item.id}: ${item.question.substring(0, 42)}...`);

    try {
      const result = await withRetry(() => retrieveParentCandidates(item.question, {
        category: item.category,
        childTopK: options.childTopK,
        parentTopK: options.parentTopK,
        includeChildren: options.includeChildren,
      }));

      const candidates = (result.parents || []).map(parent => buildCandidate(parent, item.id || item.question, existingLabels));
      outputQueries.push({
        id: item.id,
        question: item.question,
        category: item.category,
        difficulty: item.difficulty,
        groundTruth: item.ground_truth || '',
        sourceRelevantDocIds: item.relevant_doc_ids || [],
        childTopK: result.childTopK,
        candidateCount: candidates.length,
        labelStatus: candidates.every(candidate => typeof candidate.isRelevant === 'boolean') ? 'complete' : 'pending',
        candidates,
        retrieval: result.retrieval,
      });

      console.log(` ✅ 父段候选 ${candidates.length} 个`);
    } catch (error) {
      outputQueries.push({
        id: item.id,
        question: item.question,
        category: item.category,
        difficulty: item.difficulty,
        groundTruth: item.ground_truth || '',
        sourceRelevantDocIds: item.relevant_doc_ids || [],
        childTopK: options.childTopK,
        candidateCount: 0,
        labelStatus: 'error',
        candidates: [],
        error: error.message,
      });
      console.log(` ❌ ${error.message}`);
    }
  }

  const output = {
    version: 1,
    task: 'parent-rerank-offline-eval',
    createdAt: new Date().toISOString(),
    instructions: '请人工判断每个 candidates[].parentText 是否能回答该 Query，并将 isRelevant 从 null 改为 true 或 false。评估脚本只统计已完整标注的 Query。',
    config: {
      dataset: options.dataset,
      sampleSize: options.sampleSize,
      childTopK: options.childTopK,
      parentTopK: options.parentTopK,
      category: options.category || null,
      includeChildren: options.includeChildren,
    },
    summary: {
      queryCount: outputQueries.length,
      pendingLabels: outputQueries.filter(query => query.labelStatus !== 'complete').length,
    },
    queries: outputQueries,
  };

  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n💾 已生成待标注文件: ${options.output}`);
  console.log('   标注完成后运行: npm run eval:parent-rerank');
}

main().catch(error => {
  console.error(`\n❌ 采集失败: ${error.message}`);
  process.exit(1);
});
