"use strict";
// RAG 流式接口分阶段计时：请求发出 → retrieval 事件 → sources → 首个 content → done
// 用法: node measure-rag-stream.cjs "问题" [cookie文件]
const fs = require('fs');
const path = require('path');

const question = process.argv[2] || '武汉理工大学校训是什么？食堂有几个？';
const cookieFile = process.argv[3] || path.resolve(__dirname, '.admin-cookie.val');
const cookie = fs.existsSync(cookieFile) ? fs.readFileSync(cookieFile, 'utf8').trim() : '';

const BASE = 'http://121.199.162.21';

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
const env = loadEnv(path.resolve(__dirname, '../../deploy/.env.production'));

async function measureStream() {
  const tStart = Date.now();
  const res = await fetch(`${BASE}/api/rag/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ message: question, history: [] }),
  });
  const tConnected = Date.now();

  if (!res.ok || !res.body) {
    console.error(`HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let tRetrieval = null, tSources = null, tFirstContent = null, tDone = null;
  let contentLen = 0;
  let totalData = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') { if (!tDone) tDone = Date.now(); continue; }
        try {
          const p = JSON.parse(data);
          totalData += data.length;
          if (p.retrieval && !tRetrieval) tRetrieval = Date.now();
          if (p.sources && !tSources) tSources = Date.now();
          if (p.content) {
            contentLen += (p.content || '').length;
            if (!tFirstContent) tFirstContent = Date.now();
          }
          if (p.type === 'content' && p.done && !tDone) tDone = Date.now();
        } catch { /* ignore */ }
      }
    }
  }
  if (!tDone) tDone = Date.now();

  console.log(`问题: ${question}`);
  console.log('─────────────────────────────────────');
  console.log(`HTTP 连接就绪:    ${tConnected - tStart}ms`);
  console.log(`→ retrieval 事件: ${tRetrieval ? tRetrieval - tStart : '-'}ms  (检索完成)`);
  console.log(`→ sources 事件:   ${tSources ? tSources - tStart : '-'}ms  (来源就绪)`);
  console.log(`→ 首个 content:   ${tFirstContent ? tFirstContent - tStart : '-'}ms  (首 token，思考结束)`);
  console.log(`→ done:           ${tDone - tStart}ms  (流式输出完成)`);
  console.log(`流式输出时长:     ${tFirstContent && tDone ? tDone - tFirstContent : '-'}ms`);
  console.log(`输出字符数:       ${contentLen}`);
}

measureStream().catch(e => { console.error('失败:', e.message); process.exit(1); });
