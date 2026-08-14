"use strict";
// 决定性验证：用后端完全相同的 httpClient(requestStream + keep-alive agent) 连调 3 次，
// 对比 fetch 直测。如果第1次慢、后续快 → keep-alive 死连接复用问题。
// 容器内运行时直接读 process.env（compose env_file 已注入）
const env = process.env;
const BASE = (env.AI_BASE_URL || 'https://api.stepfun.com/v1').replace(/\/$/, '');
const MODEL = env.AI_MODEL || 'step-3.7-flash';
const API_KEY = env.AI_API_KEY || '';

if (!API_KEY) {
  console.error('容器内未注入 AI_API_KEY，请确认 env_file 生效');
  process.exit(1);
}

// 后端同款 httpClient
const httpClient = require('/app/backend/src/utils/httpClient');

function buildOptions() {
  const url = new URL(BASE + '/chat/completions');
  return {
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': 'Bearer ' + API_KEY,
    },
    timeout: 60000,
  };
}

const context = '武汉理工大学是教育部直属全国重点大学，国家"211工程"和"双一流"建设高校，校训为"厚德博学、追求卓越"。'.repeat(150); // ~6000字

async function viaHttpClient(label) {
  const body = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: '你是一个校园知识问答助手。请严格依据【资料】回答。' },
      { role: 'user', content: `【资料】\n${context}\n\n武汉理工大学校训是什么？` },
    ],
    max_tokens: 200, temperature: 0.7, stream: true,
  });
  const options = buildOptions();
  options.headers['Content-Length'] = Buffer.byteLength(body, 'utf8');

  const t0 = Date.now();
  let first = null, bytes = 0, total = '';
  try {
    const res = await httpClient.requestStream(options, body);
    for await (const chunk of res) {
      total += chunk.toString('utf8');
      if (first === null) first = Date.now() - t0;
      bytes += chunk.length;
    }
  } catch (err) {
    console.log(`[${label}] 失败: ${err.message}`);
    return;
  }
  console.log(`[${label}] 首token: ${first}ms | 总耗时: ${Date.now() - t0}ms | 数据: ${bytes}B`);
}

async function viaFetch(label) {
  const t0 = Date.now();
  const res = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: '请依据资料回答。' }, { role: 'user', content: `【资料】\n${context}\n\n校训？` }],
      max_tokens: 200, temperature: 0.7, stream: true,
    }),
    signal: AbortSignal.timeout(120000),
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let first = null, bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (first === null) first = Date.now() - t0;
  }
  console.log(`[${label}] 首token: ${first}ms | 总耗时: ${Date.now() - t0}ms | 数据: ${bytes}B`);
}

(async () => {
  console.log('=== httpClient(requestStream+keep-alive) 连续 3 次 ===');
  await viaHttpClient('httpClient#1');
  await viaHttpClient('httpClient#2');
  await viaHttpClient('httpClient#3');
  console.log('=== fetch 对照 ===');
  await viaFetch('fetch#1');
  await viaFetch('fetch#2');
})().catch(e => console.error('失败:', e.message));
