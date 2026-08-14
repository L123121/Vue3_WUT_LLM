"use strict";
// 流式首 token 对比测量：
//  A) 纯 LLM 短输入（对照）
//  B) 带 ~6000 字 RAG 长上下文（模拟真实 RAG 场景的 prefill 开销）
// 直接调 StepFun API，记录 首token 与 总耗时
const fs = require('fs');

function loadEnv(file) {
  const env = {};
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch (e) {}
  return env;
}
const env = loadEnv('/root/wuli-elf/deploy/.env.production');
const BASE = (env.AI_BASE_URL || 'https://api.stepfun.com/v1').replace(/\/$/, '');
const MODEL = env.AI_MODEL || 'step-3.7-flash';

async function streamFirstToken(label, messages) {
  const t0 = Date.now();
  const res = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.AI_API_KEY },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 200, temperature: 0.7, stream: true }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok || !res.body) { console.log(`[${label}] HTTP ${res.status}`); return; }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let firstTokenMs = null;
  let dataBytes = 0;
  let done = false;
  for (;;) {
    const { done: d, value } = await reader.read();
    if (d) break;
    dataBytes += value.length;
    if (firstTokenMs === null) firstTokenMs = Date.now() - t0;
    const text = decoder.decode(value, { stream: true });
    if (text.includes('[DONE]')) done = true;
  }
  console.log(`[${label}] 首token: ${firstTokenMs}ms | 总耗时: ${Date.now() - t0}ms | 数据量: ${dataBytes}B`);
}

(async () => {
  // A) 纯 LLM 短输入
  await streamFirstToken('纯LLM短输入', [{ role: 'user', content: '武汉理工大学校训是什么？' }]);

  // B) 带 ~6000 字 RAG 长上下文（模拟真实 RAG 注入）
  const context = '武汉理工大学（Wuhan University of Technology）是教育部直属全国重点大学，国家"211工程"和"双一流"建设高校。校训为"厚德博学、追求卓越"。学校现有马房山、余家头、南湖三个校区，占地近4000亩。'.repeat(60); // ~6000字
  const messages = [
    { role: 'system', content: '你是一个基于检索资料的校园问答助手。请严格依据以下资料回答，不要编造。\n\n【资料】\n' + context },
    { role: 'user', content: '武汉理工大学校训是什么？食堂有几个？' },
  ];
  await streamFirstToken('RAG长上下文6000字', messages);

  // C) 中间档：3000 字上下文（验证 prefill 随长度线性增长）
  const context2 = context.slice(0, 3000);
  await streamFirstToken('RAG上下文3000字', [
    { role: 'system', content: '请依据资料回答。\n\n【资料】\n' + context2 },
    { role: 'user', content: '武汉理工大学校训是什么？' },
  ]);
})();
