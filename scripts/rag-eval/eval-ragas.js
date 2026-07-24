/**
 * RAGAS 离线生成质量评测
 *
 * 流程：
 *   1. 通过后端 RAG 接口导出 query + retrieved contexts + answer + ground_truth
 *   2. 调用 Python RAGAS 官方库计算 Faithfulness / Answer Relevancy / Context Precision / Context Recall
 *   3. 输出 JSON 结构化报告，供调参和综合报告复用
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { checkBackendHealth, getDocument, ragChat, withRetry } from './utils/api-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = resolve(__dirname, 'dataset/campus-qa.json');
const RESULTS_DIR = resolve(__dirname, 'results');
const SAMPLES_JSON_PATH = resolve(RESULTS_DIR, 'ragas-samples.json');
const SAMPLES_JSONL_PATH = resolve(RESULTS_DIR, 'ragas-samples.jsonl');
const RAGAS_OUTPUT_PATH = resolve(RESULTS_DIR, 'ragas-results.json');
const PYTHON_RUNNER_PATH = resolve(__dirname, 'ragas_runner.py');

mkdirSync(RESULTS_DIR, { recursive: true });

function parseCliArgs(argv = process.argv.slice(2)) {
  const getArgValue = (name, fallback = '') => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] || fallback : fallback;
  };

  const sampleValue = getArgValue('--sample', '0');
  return {
    sampleSize: Number.parseInt(sampleValue, 10) || 0,
    datasetPath: getArgValue('--dataset', DATASET_PATH),
    inputPath: getArgValue('--input', ''),
    outputPath: getArgValue('--output', RAGAS_OUTPUT_PATH),
    pythonCommand: getArgValue('--python', process.env.RAGAS_PYTHON || 'python'),
    metrics: getArgValue('--metrics', process.env.RAGAS_METRICS || ''),
    exportOnly: argv.includes('--export-only'),
    skipBackendHealth: argv.includes('--skip-health-check'),
    noCategoryFilter: argv.includes('--no-category-filter'),
    verbose: !argv.includes('--quiet'),
  };
}

function loadJson(path) {
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.samples)) return parsed.samples;
  if (Array.isArray(parsed.results)) return parsed.results;
  throw new Error(`无法从 ${path} 读取评测数组`);
}

function splitContext(context) {
  return String(context || '')
    .split(/\n\n={10,}\n\n/g)
    .map(part => part.trim())
    .filter(Boolean);
}

function forceSplit(text, chunkSize = 500, chunkOverlap = 50) {
  const chunks = [];
  const step = Math.max(1, chunkSize - chunkOverlap);
  for (let index = 0; index < text.length; index += step) {
    const chunk = text.slice(index, index + chunkSize).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function splitBySentence(text, chunkSize = 500) {
  const sentences = String(text || '').split(/(?<=[。！？.!?])\s*/);
  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize) {
      if (currentChunk.trim()) chunks.push(currentChunk.trim());
      if (sentence.length > chunkSize) {
        chunks.push(...forceSplit(sentence));
        currentChunk = '';
      } else {
        currentChunk = sentence;
      }
    } else {
      currentChunk += sentence;
    }
  }

  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  return chunks;
}

function splitByParagraph(text, chunkSize = 500, chunkOverlap = 50) {
  if (!text) return [];

  const paragraphs = String(text).split(/\n\n+/);
  const chunks = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if (paragraph.length > chunkSize) {
      if (currentChunk.trim()) chunks.push(currentChunk.trim());
      currentChunk = '';
      chunks.push(...splitBySentence(paragraph, chunkSize));
    } else if (currentChunk.length + paragraph.length > chunkSize) {
      if (currentChunk.trim()) chunks.push(currentChunk.trim());
      currentChunk = currentChunk.slice(-chunkOverlap) + paragraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }

  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  return chunks.filter(Boolean);
}

function getSourceChunkIndexes(source) {
  const indexes = [];
  if (Array.isArray(source.matchedChunkIds)) indexes.push(...source.matchedChunkIds);
  if (Array.isArray(source.chunks)) indexes.push(...source.chunks);
  if (Number.isInteger(source.chunkIndex) && source.chunkIndex >= 0) indexes.push(source.chunkIndex);

  return [...new Set(indexes)]
    .map(Number)
    .filter(index => Number.isInteger(index) && index >= 0);
}

async function extractContextsFromSources(sources = []) {
  const contexts = [];

  for (const source of sources) {
    if (!source?.id) continue;

    try {
      const doc = await getDocument(source.id);
      if (!doc?.content) continue;

      const chunks = splitByParagraph(doc.content);
      const chunkIndexes = getSourceChunkIndexes(source);
      if (chunkIndexes.length > 0 && chunks.length > 0) {
        for (const chunkIndex of chunkIndexes) {
          if (chunks[chunkIndex]) contexts.push(chunks[chunkIndex]);
        }
      } else {
        contexts.push(doc.content.slice(0, 1200));
      }
    } catch (err) {
      console.warn(`  [RAGAS] 获取文档 ${source.id} 失败: ${err.message}`);
    }
  }

  return [...new Set(contexts.map(context => context.trim()).filter(Boolean))];
}

async function extractContexts({ context, sources }) {
  const contextParts = splitContext(context);
  if (contextParts.length > 0) return contextParts;
  return extractContextsFromSources(sources);
}

function normalizeDatasetItem(item, index) {
  const question = item.question || item.query || item.user_input || '';
  const groundTruth = item.ground_truth || item.groundTruth || item.reference || '';

  return {
    id: item.id || `sample_${index + 1}`,
    question,
    ground_truth: groundTruth,
    category: item.category || 'default',
    difficulty: item.difficulty || 'unknown',
    relevant_doc_ids: item.relevant_doc_ids || item.relevantDocIds || [],
  };
}

function buildExportSummary(samples, datasetSize, skipped) {
  const valid = samples.filter(sample => !sample.error && sample.answer && sample.contexts.length > 0 && sample.ground_truth);
  return {
    total: datasetSize,
    exported: samples.length,
    validForRagas: valid.length,
    skipped,
    warnings: samples.filter(sample => sample.warning).length,
    errors: samples.filter(sample => sample.error).length,
    output: {
      json: SAMPLES_JSON_PATH,
      jsonl: SAMPLES_JSONL_PATH,
    },
  };
}

function writeSamples(samples, summary) {
  writeFileSync(SAMPLES_JSON_PATH, JSON.stringify({ summary, samples }, null, 2));
  writeFileSync(SAMPLES_JSONL_PATH, samples.map(sample => JSON.stringify(sample)).join('\n') + '\n');
}

async function exportRagasSamples(options = {}) {
  const { sampleSize = 0, datasetPath = DATASET_PATH, verbose = true, skipBackendHealth = false, noCategoryFilter = false } = options;

  if (!existsSync(datasetPath)) {
    throw new Error(`评测集不存在: ${datasetPath}`);
  }

  if (!skipBackendHealth) {
    const healthy = await checkBackendHealth();
    if (!healthy) {
      throw new Error('后端服务不可用，请先启动: cd backend && npm run dev');
    }
  }

  const dataset = loadJson(datasetPath).map(normalizeDatasetItem);
  const testSet = sampleSize > 0 ? dataset.slice(0, sampleSize) : dataset;
  const samples = [];
  let skipped = 0;

  if (verbose) {
    console.log(`📋 评测集: ${testSet.length} 条（共 ${dataset.length} 条）`);
    console.log('📤 正在从后端 RAG 管道导出 query + retrieved contexts + answer...\n');
  }

  for (let index = 0; index < testSet.length; index++) {
    const item = testSet[index];
    const progress = `[${index + 1}/${testSet.length}]`;

    if (!item.question || !item.ground_truth) {
      if (verbose) console.log(`${progress} ⏭️  ${item.id}: 缺少 question 或 ground_truth`);
      skipped++;
      continue;
    }

    try {
      if (verbose) process.stdout.write(`${progress} 🤖 ${item.id}: ${item.question.slice(0, 40)}...`);

      const ragResult = await withRetry(
        () => ragChat(item.question, [], { category: noCategoryFilter ? undefined : item.category }),
        2,
        2000
      );
      const contexts = await extractContexts(ragResult);
      const warning = contexts.length === 0 ? '无检索上下文' : '';

      samples.push({
        id: item.id,
        query: item.question,
        question: item.question,
        answer: ragResult.answer,
        retrieved_docs: contexts,
        retrieved_contexts: contexts,
        contexts,
        ground_truth: item.ground_truth,
        reference: item.ground_truth,
        category: item.category,
        difficulty: item.difficulty,
        relevant_doc_ids: item.relevant_doc_ids,
        sources: ragResult.sources,
        retrieval: ragResult.retrieval,
        model: ragResult.model,
        warning,
      });

      if (verbose) {
        const status = warning ? '⚠️' : '✅';
        console.log(` ${status} contexts=${contexts.length} answer=${ragResult.answer.length} chars`);
      }
    } catch (err) {
      console.error(` ❌ 错误: ${err.message}`);
      samples.push({
        id: item.id,
        query: item.question,
        question: item.question,
        answer: '',
        retrieved_docs: [],
        retrieved_contexts: [],
        contexts: [],
        ground_truth: item.ground_truth,
        reference: item.ground_truth,
        category: item.category,
        difficulty: item.difficulty,
        relevant_doc_ids: item.relevant_doc_ids,
        sources: [],
        retrieval: null,
        error: err.message,
      });
    }
  }

  const summary = buildExportSummary(samples, testSet.length, skipped);
  writeSamples(samples, summary);

  if (verbose) {
    console.log('\n📦 RAGAS 样本已导出');
    console.log(`   JSON:  ${SAMPLES_JSON_PATH}`);
    console.log(`   JSONL: ${SAMPLES_JSONL_PATH}`);
    console.log(`   有效样本: ${summary.validForRagas} / ${summary.total}`);
  }

  return { summary, samples };
}

function runPythonRagas({ inputPath, outputPath, pythonCommand, metrics = '', verbose = true }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const args = [PYTHON_RUNNER_PATH, '--input', inputPath, '--output', outputPath];
    if (metrics) args.push('--metrics', metrics);

    const child = spawn(pythonCommand, args, {
      cwd: __dirname,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', chunk => {
      if (verbose) process.stdout.write(chunk.toString());
    });
    child.stderr.on('data', chunk => {
      if (verbose) process.stderr.write(chunk.toString());
    });

    child.on('error', err => {
      rejectPromise(new Error(`无法启动 Python RAGAS: ${err.message}\n请先执行: python -m pip install -r scripts/rag-eval/requirements.txt`));
    });

    child.on('close', code => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`Python RAGAS 评测失败，退出码: ${code}\n请确认已安装依赖: python -m pip install -r scripts/rag-eval/requirements.txt`));
      }
    });
  });
}

function printRagasSummary(output) {
  const summary = output?.summary;
  if (!summary) return;

  console.log('\n📊 RAGAS 生成质量评测结果');
  console.log('─────────────────────────────────');
  console.log(`  有效样本: ${summary.evaluated} / ${summary.total}`);
  console.log(`  跳过: ${summary.skipped}`);
  console.log(`  错误: ${summary.errors}`);
  console.log('─────────────────────────────────');
  console.log('  整体指标:');
  console.log(`    Faithfulness:       ${summary.overall.faithfulness}`);
  console.log(`    Answer Relevancy:   ${summary.overall.answer_relevancy}`);
  console.log(`    Context Precision:  ${summary.overall.context_precision}`);
  console.log(`    Context Recall:     ${summary.overall.context_recall}`);
  console.log(`    Overall:            ${summary.overall.overall}`);
}

export async function runRagasEval(options = {}) {
  const cliOptions = process.argv[1]?.includes('eval-ragas') ? parseCliArgs() : {};
  const mergedOptions = { ...cliOptions, ...options };
  const {
    inputPath = '',
    outputPath = RAGAS_OUTPUT_PATH,
    pythonCommand = process.env.RAGAS_PYTHON || 'python',
    metrics = process.env.RAGAS_METRICS || '',
    exportOnly = false,
    verbose = true,
  } = mergedOptions;

  console.log('\n========================================');
  console.log('  RAGAS 离线生成质量评测');
  console.log('========================================\n');

  let samplesPath = inputPath ? resolve(inputPath) : SAMPLES_JSON_PATH;
  let exportResult = null;

  if (!inputPath) {
    exportResult = await exportRagasSamples(mergedOptions);
    samplesPath = SAMPLES_JSON_PATH;
  }

  if (exportOnly) {
    console.log('\n✅ 已完成样本导出，跳过 Python RAGAS 评分');
    return {
      summary: exportResult?.summary || null,
      results: exportResult?.samples || [],
      timestamp: new Date().toISOString(),
    };
  }

  console.log('\n🐍 正在调用 Python RAGAS 官方库评分...');
  await runPythonRagas({ inputPath: samplesPath, outputPath, pythonCommand, metrics, verbose });

  const output = JSON.parse(readFileSync(outputPath, 'utf-8'));
  printRagasSummary(output);
  console.log(`\n💾 RAGAS 结果已保存: ${outputPath}`);

  return output;
}

if (process.argv[1] && process.argv[1].includes('eval-ragas')) {
  runRagasEval().catch(err => {
    console.error('\n❌ RAGAS 评测失败:', err.message);
    process.exit(1);
  });
}


