// 端到端验证：用服务器真实 JWT_SECRET 调线上 /api/rag/chat 接口
const crypto = require('crypto');

const JWT_SECRET = process.env.SERVER_JWT_SECRET || 'gpICSOnmOcx_4TeRlL85y1X-1wScE4T2AIQceO9WNRiK4Ho-z5QY6XTRe_Fl81SQ';
const BASE = 'http://121.199.162.21';

function makeJWT(payload, secret) {
  const hdr = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const bdy = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(hdr + '.' + bdy).digest('base64url');
  return hdr + '.' + bdy + '.' + sig;
}

const token = makeJWT(
  { userId: 'eval-verify', username: 'verify', role: 'admin', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 },
  JWT_SECRET
);

async function ask(question) {
  const url = BASE + '/api/rag/chat/stream';
  console.log(`\n===== 提问: ${question} =====`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'auth_token=' + token,
    },
    body: JSON.stringify({ message: question, history: [], category: 'general' }),
  });
  if (!res.ok) {
    console.log('HTTP', res.status, await res.text());
    return;
  }
  const text = await res.text();
  let answer = '', sources = [], retrieval = null;
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') continue;
    try {
      const p = JSON.parse(data);
      if (p.sources) sources = p.sources;
      if (p.retrieval) retrieval = p.retrieval;
      if (p.content) answer += p.content;
      if (p.error) console.log('ERR:', p.error);
    } catch (e) { /* ignore */ }
  }
  console.log('回答:', (answer || '(空)').slice(0, 500));
  console.log('来源数:', sources.length);
  for (const s of sources.slice(0, 5)) {
    console.log('  -', s.title || s.name || s.docId || s, '| score:', s.score !== undefined ? +s.score.toFixed(3) : '');
  }
  if (retrieval) {
    console.log('retrieval model:', JSON.stringify(retrieval).slice(0, 300));
  }
  return { answer, sources };
}

(async () => {
  const r1 = await ask('离散数学期末考试会考什么内容');
  console.log('\n--- 召回判断 ---');
  const relevant = r1.sources.some(s => JSON.stringify(s).includes('离散') || JSON.stringify(s).includes('离散结构'));
  console.log(relevant ? '✅ 召回到离散数学相关文档' : '❌ 未召回到离散数学文档');
  const rerankModel = r1.sources[0] && r1.sources[0]._rerankModel;
  console.log('rerankModel:', rerankModel || '(未见)');
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
