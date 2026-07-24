/**
 * RAGAS 等价评测脚本（纯 Node.js，无 Python 依赖）
 *
 * 用 StepFun 作为 LLM judge，对 Faithfulness / Context Precision / Context Recall 打分。
 * 不依赖 Python RAGAS 库，所有指标通过 LLM-as-judge 实现。
 *
 * 用法：
 *   RAG_API_BASE=http://localhost:3000 AI_API_KEY=sk-xxx node eval-ragas.js
 *   RAG_API_BASE=http://localhost:3000 AI_API_KEY=sk-xxx node eval-ragas.js --export
 *
 * 环境变量：
 *   RAG_API_BASE    — RAG 服务地址（默认 http://localhost:3000）
 *   AI_API_KEY      — StepFun API Key（用于 LLM judge）
 *   AI_BASE_URL     — StepFun 地址（默认 https://api.stepfun.com/v1）
 *   AI_MODEL        — judge 模型（默认 step-3.7-flash）
 *   DATASET_PATH    — 评测数据集路径（默认 ./dataset/qa.json）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ==================== 配置 ====================

const RAG_API_BASE = process.env.RAG_API_BASE || 'http://localhost:3000';
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.stepfun.com/v1';
const AI_MODEL = process.env.AI_MODEL || 'step-3.7-flash';
const DATASET_PATH = process.env.DATASET_PATH || path.join(__dirname, 'dataset', 'qa.json');
const EXPORT = process.argv.includes('--export');

// ==================== LLM Judge 客户端 ====================

async function llmJudge(prompt) {
  if (!AI_API_KEY) {
    return '3';
  }
  try {
    const { data } = await axios.post(
      `${AI_BASE_URL}/chat/completions`,
      {
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
        temperature: 0.1,
      },
      {
        headers: { 'Authorization': `Bearer ${AI_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      }
    );
    return (data.choices?.[0]?.message?.content || '').trim();
  } catch (err) {
    console.warn(`[Judge] LLM 调用失败: ${err.message}`);
    return '3';
  }
}

// ==================== RAG 评测客户端 ====================

async function fetchRagAnswer(question) {
  try {
    const { data } = await axios.post(
      `${RAG_API_BASE}/api/rag/stream`,
      { message: question, history: [] },
      { timeout: 60000, responseType: 'text' }
    );
    return parseSseStream(data);
  } catch (err) {
    return { answer: '', context: '', sources: [], error: err.message };
  }
}

function parseSseStream(raw) {
  const lines = raw.split('\n');
  let answer = '';
  let sources = [];
  let error = null;

  for (const line of lines) {
    const t = line.trim();
    if (!t || !t.startsWith('data: ')) continue;
    const payload = t.slice(6);
    if (payload === '[DONE]') break;
    try {
      const json = JSON.parse(payload);
      if (json.content !== undefined) answer += json.content;
      if (json.sources) sources = json.sources;
      if (json.error) error = json.error;
    } catch { /* skip */ }
  }
  return { answer, sources, error };
}

// ==================== 指标计算 ====================

/**
 * Faithfulness：答案中的每个事实主张是否都能在上下文中找到依据
 * 使用 LLM-as-judge 打分，输出归一化到 [0, 1]
 */
async function calcFaithfulness(question, answer, sources) {
  if (!answer) return { score: 0, reason: '无答案' };
  if (!sources || sources.length === 0) return { score: 0, reason: '无检索来源' };

  const ctx = sources.map((s, i) =>
    `[${i + 1}] ${s.title}: 匹配 ${s.matchedChunks || 0} 段，分数 ${(s.matchedScore || 0).toFixed(3)}`
  ).join('\n');

  const prompt = [
    '你是一个 RAG 评测助手。请判断"答案"中的每个事实主张是否都能在"参考资料"中找到依据。',
    '',
    '评分标准（只输出 1-5 的整数）：',
    '5 = 答案中的所有主张都能在参考资料中找到明确依据',
    '4 = 大部分主张有依据，个别细节无法验证',
    '3 = 部分主张有依据，部分无依据',
    '2 = 大部分主张无依据',
    '1 = 答案完全无法从参考资料中找到依据',
    '',
    '参考资料：',
    ctx.slice(0, 3000),
    '',
    '答案：' + answer.slice(0, 1000),
    '',
    '分数：',
  ].join('\n');

  const result = await llmJudge(prompt);
  const score = Math.max(1, Math.min(5, parseInt(result) || 3));
  return { score: score / 5, reason: `${score}/5` };
}

/**
 * Context Precision：检索到的文档有多少是和问题相关的
 */
async function calcContextPrecision(question, sources) {
  if (!sources || sources.length === 0) return { score: 0, reason: '无检索结果' };

  const summary = sources.map((s, i) =>
    `[${i + 1}] ${s.title}（匹配 ${s.matchedChunks || 0} 段，分数 ${(s.matchedScore || 0).toFixed(3)}）`
  ).join('\n');

  const prompt = [
    '你是一个 RAG 评测助手。请判断检索到的文档是否与用户问题相关。',
    '',
    '评分标准（只输出 1-5 的整数）：',
    '5 = 所有检索结果都与问题高度相关',
    '4 = 大部分检索结果相关',
    '3 = 约一半检索结果相关',
    '2 = 小部分检索结果相关',
    '1 = 检索结果与问题无关',
    '',
    '用户问题：' + question,
    '',
    '检索结果：',
    summary,
    '',
    '分数：',
  ].join('\n');

  const result = await llmJudge(prompt);
  const score = Math.max(1, Math.min(5, parseInt(result) || 3));
  return { score: score / 5, reason: `${score}/5` };
}

/**
 * Context Recall：回答所需的关键信息是否都在检索结果中
 */
async function calcContextRecall(question, sources) {
  if (!sources || sources.length === 0) return { score: 0, reason: '无检索结果' };

  const summary = sources.map((s, i) =>
    `[${i + 1}] ${s.title}（匹配 ${s.matchedChunks || 0} 段，分数 ${(s.matchedScore || 0).toFixed(3)}）`
  ).join('\n');

  const prompt = [
    '你是一个 RAG 评测助手。请判断回答用户问题所需的关键信息是否都被检索到了。',
    '',
    '评分标准（只输出 1-5 的整数）：',
    '5 = 回答所需的所有关键信息都被检索到',
    '4 = 大部分关键信息被检索到，遗漏少量次要信息',
    '3 = 部分关键信息被检索到，部分遗漏',
    '2 = 大部分关键信息未被检索到',
    '1 = 完全没有检索到所需信息',
    '',
    '用户问题：' + question,
    '',
    '检索到的文档：',
    summary,
    '',
    '分数：',
  ].join('\n');

  const result = await llmJudge(prompt);
  const score = Math.max(1, Math.min(5, parseInt(result) || 3));
  return { score: score / 5, reason: `${score}/5` };
}

/**
 * 拒答检测：无答案问题时，系统是否正确拒答
 */
function calcRejection(answer, expectedAnswer) {
  if (expectedAnswer !== null) return null;
  const rejected = !answer || answer.includes('知识库中没有检索到') || answer.includes('资料不足') || answer.length < 30;
  return rejected ? 1 : 0;
}

// ==================== 报告 ====================

function printReport(results) {
  const valid = results.filter(r => !r.error);
  const rejectTests = results.filter(r => r.rejectionAccuracy !== null);
  const rejectCorrect = rejectTests.filter(r => r.rejectionAccuracy === 1);

  const avgF = valid.reduce((s, r) => s + r.faithfulness.score, 0) / Math.max(valid.length, 1);
  const avgP = valid.reduce((s, r) => s + r.contextPrecision.score, 0) / Math.max(valid.length, 1);
  const avgR = valid.reduce((s, r) => s + r.contextRecall.score, 0) / Math.max(valid.length, 1);
  const rejectRate = rejectTests.length > 0 ? rejectCorrect.length / rejectTests.length : null;

  console.log('\n' + '='.repeat(60));
  console.log('  RAGAS 等价评测报告');
  console.log('='.repeat(60));
  console.log('  评测集: ' + results.length + ' 题');
  console.log('  有效回答: ' + valid.length + ' 题');
  console.log('  拒答测试: ' + rejectTests.length + ' 题');
  console.log('');
  console.log('  ┌──────────────────────┬──────────┐');
  console.log('  │ Faithfulness（忠实度）  │  ' + (avgF * 100).toFixed(1) + '%      │');
  console.log('  │ Context Precision（精确度）│  ' + (avgP * 100).toFixed(1) + '%      │');
  console.log('  │ Context Recall（召回率）  │  ' + (avgR * 100).toFixed(1) + '%      │');
  if (rejectRate !== null) {
    console.log('  │ 拒答准确率              │  ' + (rejectRate * 100).toFixed(1) + '%      │');
  }
  console.log('  └──────────────────────┴──────────┘');
  console.log('');

  console.log('  逐题详情:');
  for (const r of results) {
    const status = r.error ? '❌' : '✅';
    const rej = r.rejectionAccuracy !== null ? (r.rejectionAccuracy ? ' ✓拒答' : ' ✗未拒答') : '';
    console.log(
      '  ' + status + ' ' +
      (r.question || '').slice(0, 24).padEnd(26) +
      ' F:' + (r.faithfulness.score * 100).toFixed(0) + '%' +
      ' P:' + (r.contextPrecision.score * 100).toFixed(0) + '%' +
      ' R:' + (r.contextRecall.score * 100).toFixed(0) + '%' +
      rej
    );
  }
  console.log('');

  return {
    summary: {
      total: results.length,
      valid: valid.length,
      rejectTests: rejectTests.length,
      faithfulness: avgF,
      contextPrecision: avgP,
      contextRecall: avgR,
      rejectionAccuracy: rejectRate,
    },
    details: results,
  };
}

// ==================== 主流程 ====================

async function main() {
  console.log('RAGAS 等价评测工具（纯 Node.js）');
  console.log('─'.repeat(40));
  console.log('  RAG API: ' + RAG_API_BASE);
  console.log('  Judge 模型: ' + AI_MODEL);
  console.log('  数据集: ' + DATASET_PATH);
  console.log('');

  let dataset;
  try {
    dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'));
  } catch (err) {
    console.error('无法加载数据集: ' + err.message);
    process.exit(1);
  }
  console.log('加载 ' + dataset.length + ' 条评测用例\n');

  const results = [];
  for (let i = 0; i < dataset.length; i++) {
    const { question, expected_answer } = dataset[i];
    process.stdout.write('[' + (i + 1) + '/' + dataset.length + '] ' + question + ' ... ');

    const { answer, sources, error } = await fetchRagAnswer(question);

    if (error) {
      console.log('❌');
      results.push({
        question, error,
        faithfulness: { score: 0, reason: '请求失败' },
        contextPrecision: { score: 0, reason: '请求失败' },
        contextRecall: { score: 0, reason: '请求失败' },
        rejectionAccuracy: null,
      });
      continue;
    }

    const [faithfulness, contextPrecision, contextRecall] = await Promise.all([
      calcFaithfulness(question, answer, sources),
      calcContextPrecision(question, sources),
      calcContextRecall(question, sources),
    ]);
    const rejectionAccuracy = calcRejection(answer, expected_answer);

    console.log(
      'F:' + (faithfulness.score * 100).toFixed(0) + '%' +
      ' P:' + (contextPrecision.score * 100).toFixed(0) + '%' +
      ' R:' + (contextRecall.score * 100).toFixed(0) + '%' +
      (rejectionAccuracy !== null ? (rejectionAccuracy ? ' ✓拒答' : ' ✗未拒答') : '')
    );

    results.push({
      question,
      answer: answer.slice(0, 200),
      faithfulness,
      contextPrecision,
      contextRecall,
      rejectionAccuracy,
    });

    if (i < dataset.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  const report = printReport(results);

  if (EXPORT) {
    const outputPath = path.join(__dirname, 'report-' + Date.now() + '.json');
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log('报告已导出: ' + outputPath);
  }
}

main().catch(err => {
  console.error('评测失败:', err);
  process.exit(1);
});
