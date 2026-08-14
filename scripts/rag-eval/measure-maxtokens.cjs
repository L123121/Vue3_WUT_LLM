"use strict";
// 验证 max_tokens 对首 token 时间的影响（同一 6000 字上下文，不同输出预算）
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

async function firstToken(label, maxTokens) {
  const context = '武汉理工大学（Wuhan University of Technology）是教育部直属全国重点大学，校训为厚德博学追求卓越。'.repeat(60);
  const t0 = Date.now();
  const res = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.AI_API_KEY },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: '依据资料回答：武汉理工大学校训是什么？\n【资料】' + context }],
      max_tokens: maxTokens, temperature: 0.7, stream: true,
    }),
    signal: AbortSignal.timeout(120000),
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let first = null;
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (first === null) first = Date.now() - t0;
  }
  console.log(`[${label}] 首token: ${first}ms | 总耗时: ${Date.now() - t0}ms | 数据量: ${bytes}B`);
}

(async () => {
  await firstToken('max_tokens=200', 200);
  await firstToken('max_tokens=1000', 1000);
  await firstToken('max_tokens=4000', 4000);
})().catch(e => console.error('失败:', e.message));
