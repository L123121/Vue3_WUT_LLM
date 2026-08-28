/**
 * 线上 badcase 自动沉淀评测集
 *
 * 背景：RagFeedback 的 dislike 数据此前只做统计展示，不回流评测——
 * 回归测试集（full-coverage-qa.json 等）是静态的，线上新出现的坏例无法被回归覆盖。
 *
 * 本脚本把线上反馈导出为评测数据集条目（pending_annotation 状态），
 * 人工补上 relevant_doc_ids / ground_truth 后即可并入回归评测：
 *
 *   1. 拉取反馈：GET /api/rag/feedback?rating=dislike（需管理员 Cookie）
 *   2. 去重合并：已导出过的反馈（按 userId+feedbackId）跳过
 *   3. 写入 dataset/badcases-from-feedback.json，每条带原始回答/来源/traceId
 *
 * 用法：
 *   cd scripts/rag-eval
 *   RAG_EVAL_COOKIE="auth_token=..." BACKEND_URL=http://localhost:3000 node export-badcases.cjs
 *   node export-badcases.cjs --rating=all --out=dataset/my-badcases.json --limit=500
 */
"use strict";

const { readFileSync, writeFileSync, existsSync } = require('fs');
const { resolve } = require('path');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const COOKIE = process.env.RAG_EVAL_COOKIE || '';
const DEFAULT_OUT = resolve(__dirname, 'dataset', 'badcases-from-feedback.json');

// ---------- CLI 参数 ----------
function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const m = arg.match(/^--([a-z-]+)(?:=(.*))?$/i);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  }
  return args;
}
const args = parseArgs(process.argv.slice(2));
const RATING = ['all', 'like', 'dislike'].includes(args.rating) ? args.rating : 'dislike';
const OUT_PATH = args.out ? resolve(process.cwd(), args.out) : DEFAULT_OUT;
const MAX_ITEMS = parseInt(args.limit, 10) || Infinity;

// ---------- 反馈拉取（分页） ----------
async function fetchFeedbackPage(rating, page, limit) {
  const ratingQuery = rating === 'all' ? '' : `&rating=${rating}`;
  const url = `${BACKEND_URL}/api/rag/feedback?page=${page}&limit=${limit}${ratingQuery}`;
  const response = await fetch(url, {
    headers: { Cookie: COOKIE },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('接口需要管理员登录：请设置 RAG_EVAL_COOKIE="auth_token=管理员cookie" 后重试');
  }
  if (!response.ok) {
    throw new Error(`拉取反馈失败: HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (!payload?.success) {
    throw new Error(`拉取反馈失败: ${payload?.error || '未知错误'}`);
  }
  return payload.data; // { items, summary, pagination }
}

async function fetchAllFeedback(rating, maxItems) {
  const all = [];
  let page = 1;
  while (all.length < maxItems) {
    const pageSize = Math.min(100, maxItems - all.length);
    const data = await fetchFeedbackPage(rating, page, pageSize);
    const items = data.items || [];
    all.push(...items);
    const { total = 0, page: currentPage = page, totalPages = 1 } = data.pagination || {};
    console.log(`  第 ${currentPage}/${totalPages} 页，累计 ${all.length}/${total} 条`);
    if (items.length === 0 || currentPage >= totalPages) break;
    page += 1;
  }
  return all;
}

// ---------- 数据集条目构造 ----------
function toDatasetEntry(feedback) {
  // 与 eval-retrieval 数据集字段对齐；relevant_doc_ids 留待人工标注
  const sources = Array.isArray(feedback.sources)
    ? feedback.sources.map(s => s.id).filter(Boolean)
    : [];
  return {
    id: `FB-${feedback.userId}-${feedback.id}`,
    question: feedback.question || '',
    ground_truth: '',
    category: '线上反馈',
    difficulty: 'unknown',
    relevant_doc_ids: [], // TODO: 人工标注（可参考 sources 候选）
    status: 'pending_annotation',
    candidate_doc_ids: sources,
    feedback: {
      rating: feedback.rating,
      answer: feedback.answer || '',
      traceId: feedback.traceId || '',
      conversationId: feedback.conversationId || '',
      createdAt: feedback.createdAt || '',
    },
  };
}

// ---------- 主流程 ----------
(async () => {
  if (!COOKIE) {
    console.error('缺少 RAG_EVAL_COOKIE 环境变量（管理员 Cookie）。');
    console.error('用法: RAG_EVAL_COOKIE="auth_token=..." node export-badcases.cjs [--rating=dislike|like|all] [--out=path] [--limit=N]');
    process.exit(1);
  }

  console.log(`后端: ${BACKEND_URL} | 筛选: ${RATING} | 输出: ${OUT_PATH}`);

  console.log('拉取线上反馈...');
  const feedbackList = await fetchAllFeedback(RATING, MAX_ITEMS);
  if (feedbackList.length === 0) {
    console.log('没有符合条件的反馈，无需导出。');
    return;
  }

  // 合并已有数据集，按 id 去重（幂等：重复执行只增量写入）
  const existing = existsSync(OUT_PATH)
    ? JSON.parse(readFileSync(OUT_PATH, 'utf-8'))
    : [];
  const knownIds = new Set(existing.map(e => e.id));
  const newEntries = feedbackList
    .map(toDatasetEntry)
    .filter(e => !knownIds.has(e.id));

  if (newEntries.length === 0) {
    console.log(`已有数据集 ${existing.length} 条，本次无新增。`);
    return;
  }

  const merged = [...existing, ...newEntries];
  // 每条一行，与 dataset/*.json 风格一致
  writeFileSync(
    OUT_PATH,
    '[\n' + merged.map(e => JSON.stringify(e)).join(',\n') + '\n]',
  );

  const pending = merged.filter(e => e.status === 'pending_annotation').length;
  console.log('\n========================================');
  console.log(`新增 ${newEntries.length} 条 | 数据集共 ${merged.length} 条 | 待标注 ${pending} 条`);
  console.log('下一步:');
  console.log(`  1. 打开 ${OUT_PATH} 为每条补充 ground_truth 与 relevant_doc_ids`);
  console.log('     （candidate_doc_ids 为回答引用来源，可作为标注起点）');
  console.log('  2. 标注完成后将 status 改为 ready，即可并入 DATASET_PATH 跑回归评测');
})().catch(err => {
  console.error('导出失败:', err.message);
  process.exit(1);
});
