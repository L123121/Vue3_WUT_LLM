"use strict";
// 决定性实验：真实 6000+ 中文字符 RAG 上下文 + 后端同构 prompt 结构，直测流式首 token
// 模拟 rag.service buildParentChildPrompt 的 prompt 形状（system 指令 + 【资料】+ 问题）
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

async function measure(label, contextChars) {
  // 用真实中文段落拼到目标长度（模拟 RAG 上下文）
  const para = '武汉理工大学是教育部直属的全国重点大学，国家"211工程"和"双一流"建设高校，校训为"厚德博学、追求卓越"。学校现有马房山、余家头、南湖三个校区，设有多个国家级科研平台和优势学科，师资力量雄厚。';
  let context = '';
  while (context.length < contextChars) context += para;
  context = context.slice(0, contextChars);

  const systemPrompt = `你是一个校园知识问答助手。请严格依据【资料】中的内容回答用户问题，如果资料中没有相关信息，请明确告知无法回答，不要编造。回答请简洁、准确、条理清晰。`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `【资料】\n${context}\n\n请回答：武汉理工大学的校训是什么？` },
  ];

  const t0 = Date.now();
  const res = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.AI_API_KEY },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 1000, temperature: 0.7, stream: true }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok || !res.body) { console.log(`[${label}] HTTP ${res.status}: ${(await res.text()).slice(0,150)}`); return; }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let first = null, bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (first === null) first = Date.now() - t0;
  }
  console.log(`[${label}] 上下文=${contextChars}字 body=${JSON.stringify(messages).length}B | 首token: ${first}ms | 总耗时: ${Date.now() - t0}ms | 数据: ${bytes}B`);
}

(async () => {
  await measure('3000字上下文', 3000);
  await measure('6000字上下文', 6000);
  await measure('9000字上下文', 9000);
})().catch(e => console.error('失败:', e.message));
