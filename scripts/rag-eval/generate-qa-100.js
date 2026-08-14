/**
 * 基于知识库文档生成 100 道测试题（LLM 生成，覆盖全部文档）
 * 用法: node generate-qa-100.js
 * 输出: dataset/ragdata-100-qa.json
 */
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { config } from 'dotenv';
import { listDocuments, getDocument } from './utils/api-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../backend/.env') });
config({ path: resolve(__dirname, '../../../.env') });
config({ path: resolve(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'wuli-elf-dev-jwt-secret-2026-change-in-prod';
function makeJwt(p, s) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b({ alg: 'HS256', typ: 'JWT' });
  const pld = b({ ...p, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = crypto.createHmac('sha256', s).update(h + '.' + pld).digest('base64url');
  return h + '.' + pld + '.' + sig;
}
process.env.RAG_EVAL_COOKIE = 'auth_token=' + makeJwt({ userId: 'eval', username: 'eval', role: 'admin' }, JWT_SECRET);

const AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.stepfun.com/step_plan/v1';
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'step-3.7-flash';
const TOTAL_QUESTIONS = 100;

async function llmGenerate(prompt) {
  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_API_KEY}` },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: '你是测试题生成器。严格输出 JSON 数组，不要输出任何其他文字。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    }),
  });
  if (!response.ok) throw new Error(`LLM API ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  return content;
}

function parseQuestions(content) {
  const cleaned = content.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const arr = JSON.parse(slice);
  if (!Array.isArray(arr)) throw new Error('LLM 未返回数组');
  return arr.map(q => ({
    question: String(q.question || q.q || '').trim(),
    ground_truth: String(q.ground_truth || q.answer || q.a || '').trim(),
    difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium',
  })).filter(q => q.question && q.ground_truth);
}

// 按 chunkCount 加权分配题目数，总计 TOTAL_QUESTIONS
function allocateQuestions(docs) {
  const totalChunks = docs.reduce((sum, d) => sum + (d.chunkCount || 1), 0);
  let remaining = TOTAL_QUESTIONS;
  const allocated = docs.map(d => {
    const n = Math.max(1, Math.round((d.chunkCount || 1) / totalChunks * TOTAL_QUESTIONS));
    return { doc: d, n };
  });
  // 修正总数偏差
  const sum = allocated.reduce((s, a) => s + a.n, 0);
  let diff = TOTAL_QUESTIONS - sum;
  let i = 0;
  while (diff !== 0 && i < 1000) {
    const idx = diff > 0 ? 0 : allocated.length - 1;
    allocated[idx].n += diff > 0 ? 1 : -1;
    diff = TOTAL_QUESTIONS - allocated.reduce((s, a) => s + a.n, 0);
    i++;
  }
  return allocated;
}

async function main() {
  console.log('📚 拉取文档列表...');
  const docs = await listDocuments();
  console.log(`   共 ${docs.length} 个文档\n`);

  const allocated = allocateQuestions(docs);
  console.log('📊 题目分配:');
  allocated.forEach(a => console.log(`   ${String(a.doc.title).slice(0, 30).padEnd(32)} => ${a.n} 题 (chunks=${a.doc.chunkCount})`));
  console.log(`   合计: ${allocated.reduce((s, a) => s + a.n, 0)} 题\n`);

  const allQuestions = [];
  let qid = 1;

  for (const { doc, n } of allocated) {
    console.log(`🤖 生成《${doc.title}》的 ${n} 道题...`);
    let content = '';
    try {
      const detail = await getDocument(doc.id);
      content = detail.content || '';
    } catch (e) {
      console.log(`   ⚠️ 拉取内容失败: ${e.message}，跳过`);
      continue;
    }
    if (!content.trim()) { console.log('   ⚠️ 内容为空，跳过'); continue; }

    // 截断过长内容（按 6000 字窗口，分多次生成）
    const windowSize = 6000;
    const perWindow = Math.max(1, Math.ceil(n / Math.max(1, Math.ceil(content.length / windowSize))));
    let generated = 0;

    for (let offset = 0; offset < content.length && generated < n; offset += windowSize) {
      const windowText = content.slice(offset, offset + windowSize);
      const prompt = `基于下面的文档内容，生成 ${Math.min(perWindow, n - generated)} 道中文问答题。题目要能根据这段内容回答，覆盖不同知识点，不要重复。每道题包含 question（问题）、ground_truth（标准答案，来自原文）、difficulty（easy/medium/hard）。
文档内容：
---
${windowText.slice(0, 5800)}
---
输出格式: {"questions": [{"question": "...", "ground_truth": "...", "difficulty": "medium"}]}`;

      try {
        const resp = await llmGenerate(prompt);
        const parsed = JSON.parse(resp.replace(/```json|```/g, '').trim());
        const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
        for (const q of questions) {
          if (generated >= n) break;
          allQuestions.push({
            id: `q${String(qid).padStart(3, '0')}`,
            question: String(q.question || '').trim(),
            ground_truth: String(q.ground_truth || '').trim(),
            category: doc.category || 'general',
            relevant_doc_ids: [doc.id],
            difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium',
          });
          generated++;
          qid++;
        }
        console.log(`   ✅ 本窗口生成 ${questions.length} 题（累计 ${generated}/${n}）`);
      } catch (e) {
        console.log(`   ❌ 生成失败: ${e.message}`);
      }
    }
    if (generated < n) console.log(`   ⚠️ 实际生成 ${generated}/${n}`);
    console.log('');
  }

  console.log('─'.repeat(40));
  console.log(`📝 共生成 ${allQuestions.length} 道题`);

  const outputPath = resolve(__dirname, 'dataset/ragdata-100-qa.json');
  writeFileSync(outputPath, JSON.stringify(allQuestions, null, 2), 'utf-8');
  console.log(`💾 已保存: ${outputPath}`);
  console.log(`   关联文档数: ${new Set(allQuestions.map(q => q.relevant_doc_ids[0])).size}`);
}

main().catch(err => { console.error(`\n💥 ${err.message}`); process.exit(1); });
