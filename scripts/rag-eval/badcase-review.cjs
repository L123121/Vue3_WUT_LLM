/**
 * Badcase 标注助手 —— 让"线上反馈 → 回归测试集"闭环真正转起来
 *
 * 配合 export-badcases.cjs 使用。导出的条目分两种状态：
 *   pending_annotation  待人工标注（relevant_doc_ids 为空，评测时自动跳过）
 *   ready               已标注，可被 DATASET_PATH 并入回归评测
 *
 * 子命令：
 *   node badcase-review.cjs                                  # 状态总览 + 待标注清单
 *   node badcase-review.cjs annotate --id=FB-xxx --docs=doc_a,doc_b [--gt="标准答案"]
 *                                                            # 一条命令完成单条标注 → ready
 *   node badcase-review.cjs validate                          # 校验 ready 条目引用的 docId 是否仍存在（需后端）
 *
 * 通用参数：
 *   --file=path   指定数据集文件（默认 dataset/badcases-from-feedback.json）
 */
"use strict";

const { readFileSync, writeFileSync, existsSync } = require('fs');
const { resolve } = require('path');

const DEFAULT_FILE = resolve(__dirname, 'dataset', 'badcases-from-feedback.json');

// ---------- CLI ----------
function parseArgs(argv) {
  const args = { _: [] };
  for (const arg of argv) {
    const m = arg.match(/^--([a-zA-Z-]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
    else args._.push(arg);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const FILE = args.file ? resolve(process.cwd(), args.file) : DEFAULT_FILE;
const CMD = args._[0] || 'status';

function loadDataset() {
  if (!existsSync(FILE)) {
    console.error(`文件不存在: ${FILE}`);
    console.error('先运行 export-badcases.cjs 导出线上反馈，或用 --file= 指定路径。');
    process.exit(1);
  }
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf-8'));
    if (!Array.isArray(data)) throw new Error('顶层不是数组');
    return data;
  } catch (err) {
    console.error(`解析失败(${FILE}): ${err.message}`);
    process.exit(1);
  }
}

function saveDataset(dataset) {
  writeFileSync(FILE, '[\n' + dataset.map(e => JSON.stringify(e)).join(',\n') + '\n]');
}

function truncate(s, n) {
  const text = String(s || '').replace(/\s+/g, ' ').trim();
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

function validIds(entry) {
  return (entry.relevant_doc_ids || []).filter(id => id && !String(id).startsWith('TODO'));
}

// ---------- status：状态总览 ----------
function showStatus(dataset) {
  const ready = dataset.filter(e => e.status === 'ready' && validIds(e).length > 0);
  const broken = dataset.filter(e => e.status === 'ready' && validIds(e).length === 0);
  const pending = dataset.filter(e => !ready.includes(e) && !broken.includes(e));

  console.log(`数据集: ${FILE}`);
  console.log('─────────────────────────────────');
  console.log(`总量 ${dataset.length} | ✅ ready(可回归) ${ready.length} | ⏳ 待标注 ${pending.length} | ⚠️ 标了ready但缺ID ${broken.length}`);

  if (pending.length > 0) {
    console.log('\n待标注清单（按 feedback 时间倒序）:');
    [...pending].reverse().forEach((e, i) => {
      console.log(`\n[${i + 1}] ${e.id}  [${e.feedback?.rating || '?'}] ${e.feedback?.createdAt || ''}`);
      console.log(`    Q: ${truncate(e.question, 80)}`);
      console.log(`    A: ${truncate(e.feedback?.answer, 100)}`);
      const cand = e.candidate_doc_ids || [];
      console.log(`    候选来源: ${cand.length ? cand.join(', ') : '(无)'}`);
      console.log(`    标注命令:`);
      console.log(`    node badcase-review.cjs annotate --id=${e.id} --docs=<docId1,docId2> [--gt="<标准答案>"]`);
    });
  }

  if (broken.length > 0) {
    console.log('\n⚠️  以下条目标记为 ready 但没有有效 relevant_doc_ids，回归时会跳过:');
    for (const e of broken) console.log(`    ${e.id}: ${truncate(e.question, 60)}`);
  }

  if (ready.length > 0) {
    console.log('\n✅ 已就绪条目（将被 DATASET_PATH 回归覆盖）:');
    for (const e of ready) {
      console.log(`    ${e.id} | 相关文档×${validIds(e).length} | Q: ${truncate(e.question, 50)}`);
    }
    console.log('\n回归命令:');
    console.log(`  DATASET_PATH=${'$(相对 scripts/rag-eval 的路径)'} RAG_EVAL_COOKIE="auth_token=..." node eval-retrieval.js`);
    console.log(`  例: DATASET_PATH=dataset/badcases-from-feedback.json ...`);
  }
}

// ---------- annotate：一条命令标注 ----------
function annotate(dataset) {
  const idArg = String(args.id || '');
  const docsArg = String(args.docs || '');
  if (!idArg || !docsArg) {
    console.error('用法: node badcase-review.cjs annotate --id=FB-xxx --docs=doc_aaa,doc_bbb [--gt="标准答案"]');
    process.exit(1);
  }

  // 支持 id 唯一前缀匹配，省得复制长 ID
  let matches = dataset.filter(e => e.id === idArg);
  if (matches.length === 0) {
    matches = dataset.filter(e => e.id.startsWith(idArg));
    if (matches.length > 1) {
      console.error(`id 前缀 "${idArg}" 匹配到多条，请写完整: ${matches.map(m => m.id).join(', ')}`);
      process.exit(1);
    }
  }
  if (matches.length === 0) {
    console.error(`找不到条目: ${idArg}`);
    process.exit(1);
  }

  const entry = matches[0];
  const docIds = docsArg.split(',').map(d => d.trim()).filter(Boolean);
  if (docIds.length === 0) {
    console.error('--docs 不能为空（多个用英文逗号分隔）');
    process.exit(1);
  }

  entry.relevant_doc_ids = docIds;
  if (args.gt) entry.ground_truth = String(args.gt);
  entry.status = 'ready';
  entry.annotatedAt = new Date().toISOString();

  saveDataset(dataset);
  console.log(`✅ 已标注 ${entry.id} → ready`);
  console.log(`   question: ${truncate(entry.question, 60)}`);
  console.log(`   relevant_doc_ids: ${docIds.join(', ')}`);
  console.log(`   ground_truth: ${entry.ground_truth ? truncate(entry.ground_truth, 60) : '(未填写，检索回归可不填；RAGAS 评测建议补上)'}`);

  const remain = dataset.filter(e => e.status === 'pending_annotation').length;
  console.log(`\n剩余待标注: ${remain} 条`);
}

// ---------- validate：校验 ready 条目的 docId 引用 ----------
async function validate(dataset) {
  const ready = dataset.filter(e => e.status === 'ready');
  if (ready.length === 0) {
    console.log('没有 ready 条目，无需校验。');
    return;
  }
  const referenced = new Set();
  for (const e of ready) for (const id of validIds(e)) referenced.add(id);

  let knownIds = null;
  try {
    const { checkBackendHealth, listDocuments } = await import('./utils/api-client.js');
    if (!(await checkBackendHealth())) throw new Error('后端不可用');
    const docs = await listDocuments();
    knownIds = new Set(docs.map(d => d.id));
  } catch (err) {
    console.warn(`⚠️  无法连接后端获取文档列表（${err.message}），仅做格式校验。`);
  }

  let okCount = 0;
  const problems = [];
  for (const id of [...referenced].sort()) {
    if (!knownIds) continue;
    if (knownIds.has(id)) okCount++;
    else problems.push(id);
  }

  if (!knownIds) {
    console.log(`格式校验通过：${ready.length} 条 ready，共引用 ${referenced.size} 个 docId。`);
    return;
  }
  console.log('─────────────────────────────────');
  console.log(`docId 引用校验: 有效 ${okCount} | 失效 ${problems.length}`);
  if (problems.length > 0) {
    console.log('\n失效引用（文档可能已删除/重建，需更新标注）:');
    for (const id of problems) {
      const owners = ready.filter(e => validIds(e).includes(id)).map(e => e.id);
      console.log(`    ${id}  ← 被 ${owners.join(', ')} 引用`);
    }
    process.exitCode = 1;
  } else {
    console.log('全部引用有效 ✅');
  }
}

// ---------- 主入口 ----------
const dataset = loadDataset();

if (CMD === 'status') showStatus(dataset);
else if (CMD === 'annotate') annotate(dataset);
else if (CMD === 'validate') validate(dataset).catch(err => { console.error(`校验失败: ${err.message}`); process.exit(1); });
else {
  console.error(`未知子命令: ${CMD}（可用: status / annotate / validate）`);
  process.exit(1);
}
