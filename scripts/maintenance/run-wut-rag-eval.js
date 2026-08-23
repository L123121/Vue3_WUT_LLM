/**
 * 武汉理工大学校园资料RAG评估完整流程：
 * 1. 上传DOCX到知识库 → 2. 获取文档ID → 3. 更新QA数据集 → 4. 运行检索评估
 *
 * 使用 Node.js 原生 API，无需额外依赖
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BACKEND = 'http://localhost:3000';
const JWT_SECRET = 'wuli-elf-dev-jwt-secret-2026-change-in-prod';
const DOCX_PATH = path.resolve(__dirname, '武汉理工大学校园资料手册.docx');
const QA_PATH = path.resolve(__dirname, 'scripts/rag-eval/dataset/campus-qa.json');
const EVAL_SCRIPT = path.resolve(__dirname, 'scripts/rag-eval/eval-retrieval.js');

// ====== 手动 HMAC-SHA256 JWT 签名 ======
function base64url(buf) {
  return buf.toString('base64url');
}

function makeJWT(payload, secret) {
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64url(Buffer.from(JSON.stringify(payload)));
  const sig = base64url(
    crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${sig}`;
}

const JWT_TOKEN = makeJWT(
  { userId: 'eval-test-user', username: 'eval-tester', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 },
  JWT_SECRET
);
const COOKIE = `auth_token=${JWT_TOKEN}`;

// ====== 文件上传（原生 multipart/form-data） ======
async function uploadDocx() {
  console.log('\n=== 1. 上传DOCX到知识库 ===\n');

  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);

  // 构建 multipart 请求体
  const fileContent = fs.readFileSync(DOCX_PATH);
  const fileName = '武汉理工大学校园资料手册.docx';
  const fileFieldName = 'file';

  const parts = [
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="category"\r\n\r\n` +
    `学校概况`,
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="title"\r\n\r\n` +
    `武汉理工大学校园资料手册`,
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fileFieldName}"; filename="${fileName}"\r\n` +
    `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`,
  ];

  // 合并所有部分
  const head = Buffer.from(parts.join('\r\n') + '\r\n', 'utf-8');
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
  const bodyBuffer = Buffer.concat([head, fileContent, tail]);

  const r = await fetch(`${BACKEND}/api/rag/documents/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Cookie': COOKIE,
    },
    body: bodyBuffer,
  });

  const body = await r.json();
  if (!r.ok) throw new Error(`上传失败 [${r.status}]: ${JSON.stringify(body)}`);

  const doc = body.data || body;
  console.log(`✅ 上传成功`);
  console.log(`   docId: ${doc.id}`);
  console.log(`   title: ${doc.title}`);
  console.log(`   chunkCount: ${doc.chunkCount}`);
  console.log(`   vectorStatus: ${doc.vectorStatus}`);

  return doc;
}

async function waitForIndexing(docId, maxWait = 30) {
  console.log(`\n⏳ 等待向量索引完成...`);
  for (let i = 0; i < maxWait; i++) {
    const r = await fetch(`${BACKEND}/api/rag/documents/${docId}`, {
      headers: { Cookie: COOKIE },
    });
    const body = await r.json();
    const doc = body.data;
    if (doc && doc.vectorStatus === 'ready') {
      console.log(`✅ 索引完成 (${i + 1}s)`);
      return doc;
    }
    if (doc && doc.vectorStatus === 'failed') {
      console.warn(`⚠️ 索引失败，继续尝试检索`);
      return doc;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`⚠️ 等待超时，继续尝试检索`);
}

async function updateQaDataset(docId) {
  console.log(`\n=== 2. 更新QA数据集 (docId: ${docId}) ===\n`);

  const qaData = JSON.parse(fs.readFileSync(QA_PATH, 'utf-8'));
  let updated = 0;

  for (const item of qaData) {
    const ids = item.relevant_doc_ids || [];
    const hasTodo = ids.some(id => typeof id === 'string' && id.startsWith('TODO'));
    if (hasTodo) {
      const n = Math.max(item.relevant_doc_ids.length, 1);
      item.relevant_doc_ids = new Array(n).fill(docId);
      updated++;
    }
  }

  fs.writeFileSync(QA_PATH, JSON.stringify(qaData, null, 2), 'utf-8');
  console.log(`✅ 已更新 ${updated}/${qaData.length} 条样本的文档ID`);
}

async function checkBackend() {
  const r = await fetch(`${BACKEND}/api/health`);
  if (!r.ok) throw new Error(`后端不可用: ${r.status}`);
  const data = await r.json();
  console.log(`✅ 后端: ${data.message} | AI: ${data.ai_service?.model}`);
}

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  武汉理工大学校园资料 RAG 评估               ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // 0. 检查后端
  await checkBackend();

  // 1. 上传文档
  const doc = await uploadDocx();

  // 1.5 等待索引
  await waitForIndexing(doc.id);

  // 2. 更新数据集
  await updateQaDataset(doc.id);

  // 3. 运行评估（ESM 脚本）
  console.log(`\n=== 3. 运行检索质量评估 ===\n`);

  // 设置环境变量供 eval 脚本使用
  process.env.RAG_EVAL_COOKIE = COOKIE;

  // 动态导入 ESM 模块（Windows 路径需转为 file:// URL）
  const evalUrl = 'file:///' + EVAL_SCRIPT.replace(/\\/g, '/');
  const { runRetrievalEval } = await import(evalUrl);
  const result = await runRetrievalEval();

  if (result) {
    const s = result.summary;
    console.log(`\n📊 评估结果摘要:`);
    console.log(`   有效样本: ${s.evaluated}/${s.total}`);
    console.log(`   Recall: ${s.overall.recall}`);
    console.log(`   Precision: ${s.overall.precision}`);
    console.log(`   Hit Rate: ${s.overall.hitRate}`);
    console.log(`   MRR: ${s.overall.mrr}`);
    console.log(`   nDCG@5: ${s.overall['ndcg@5']}`);
    console.log(`   按类别:`);
    for (const [cat, stats] of Object.entries(s.byCategory || {})) {
      console.log(`     ${cat}: recall=${stats.recall} precision=${stats.precision} mrr=${stats.mrr} (n=${stats.count})`);
    }
    console.log(`   按难度:`);
    for (const [diff, stats] of Object.entries(s.byDifficulty || {})) {
      console.log(`     ${diff}: recall=${stats.recall} precision=${stats.precision} (n=${stats.count})`);
    }
    if (result.badCases?.length > 0) {
      console.log(`\n   Bad Cases (${result.badCases.length}):`);
      for (const bc of result.badCases.slice(0, 15)) {
        console.log(`     ${bc.id} [${bc.badCase.type}] ${bc.badCase.reason}`);
      }
    }
  }

  console.log(`\n🎉 完成！结果保存在: scripts/rag-eval/results/`);
}

main().catch(err => {
  console.error(`\n❌ 错误: ${err.message}`);
  process.exit(1);
});
