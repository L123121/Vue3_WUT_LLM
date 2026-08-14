"use strict";
// 服务器端 StepFun API 延迟测量：脚本内部从 .env.production 读取 key，不经过命令行参数
const fs = require('fs');
const path = require('path');

// 从 env 文件读取配置
function loadEnv(file) {
  const env = {};
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch (e) { console.error('读 env 失败:', e.message); }
  return env;
}

const env = loadEnv('/root/wuli-elf/deploy/.env.production');
const API_KEY = env.AI_API_KEY || '';
const BASE = (env.AI_BASE_URL || 'https://api.stepfun.com/v1').replace(/\/$/, '');
const MODEL = env.AI_MODEL || 'step-3.7-flash';

async function measure(label, body, opts = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    const t1 = Date.now();
    const text = await res.text();
    const t2 = Date.now();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* ignore */ }
    const usage = parsed?.usage || {};
    const content = parsed?.choices?.[0]?.message?.content || '';
    console.log(`[${label}] HTTP ${res.status}`);
    console.log(`  总耗时(含读响应体): ${t2 - t0}ms | 服务端返回首字节: ${t1 - t0}ms`);
    console.log(`  prompt_tokens=${usage.prompt_tokens ?? '?'} completion_tokens=${usage.completion_tokens ?? '?'} 输出字符数=${content.length}`);
    if (res.status !== 200) console.log(`  响应体: ${text.slice(0, 200)}`);
    return { ok: res.status === 200, total: t2 - t0, firstByte: t1 - t0, usage };
  } catch (err) {
    console.log(`[${label}] 失败: ${err.message}`);
    return { ok: false, total: Date.now() - t0, err: err.message };
  }
}

(async () => {
  console.log(`模型: ${MODEL} | base: ${BASE}`);

  // 1. 极短回复（max_tokens=10）：测服务端固定开销
  await measure('极短回复(10tok)', {
    model: MODEL,
    messages: [{ role: 'user', content: '说一个字：好' }],
    max_tokens: 10, temperature: 0.7,
  });

  // 2. 中等回复（max_tokens=200）：测生成速度
  await measure('中等回复(200tok)', {
    model: MODEL,
    messages: [{ role: 'user', content: '用三句话介绍武汉理工大学' }],
    max_tokens: 200, temperature: 0.7,
  });

  // 3. 大输入（模拟 RAG 上下文 ~6000 字）：测输入长度影响
  const bigInput = '武汉理工大学（Wuhan University of Technology）是教育部直属全国重点大学。'.repeat(180); // ~3600字
  await measure('大输入(约3600字)', {
    model: MODEL,
    messages: [{ role: 'user', content: `以下是资料：\n${bigInput}\n\n请回答：武汉理工大学在哪里？` }],
    max_tokens: 100, temperature: 0.7,
  });

  // 4. 流式首 token 时间
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: '用三句话介绍武汉理工大学' }],
        max_tokens: 200, temperature: 0.7, stream: true,
      }),
      signal: AbortSignal.timeout(90000),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let firstChunkMs = null;
    let total = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (firstChunkMs === null) firstChunkMs = Date.now() - t0;
      total += decoder.decode(value, { stream: true });
    }
    console.log(`[流式] 首 token 时间: ${firstChunkMs}ms | 总耗时: ${Date.now() - t0}ms | 数据量: ${total.length}B`);
  } catch (err) {
    console.log(`[流式] 失败: ${err.message}`);
  }
})();
