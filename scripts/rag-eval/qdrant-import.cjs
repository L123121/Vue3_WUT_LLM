// 一次性：从文件版 data/vectors.json 直导向量到 Qdrant（容错续导版）
// 特点：Qdrant 短时不可达时等待重试（容忍容器自动重启），直到全部导入完成
// 用法：cd backend && node ../scripts/rag-eval/qdrant-import.cjs
"use strict";
const fs = require('fs');
const path = require('path');
const { config: loadEnv } = require('dotenv');

const ROOT = path.resolve(__dirname, '..', '..');
loadEnv({ path: path.resolve(ROOT, 'backend/.env') });
loadEnv({ path: path.resolve(ROOT, '.env') });

process.env.VECTOR_STORE_BACKEND = 'qdrant';
process.env.VITEST = '1'; // 跳过 config 的 LLM key 强制检查（直导不需要 LLM）

const { QdrantVectorStore } = require(path.resolve(ROOT, 'backend/src/services/vector-store-qdrant.service'));

const VECTOR_FILE = path.resolve(ROOT, 'backend/data/vectors.json');
const BATCH = 500;
const RETRY_MS = 4000; // Qdrant 不可达时等待间隔
const MAX_RETRY = 30; // 单批最大重试次数（容忍容器自动重启）

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitReady(store) {
  for (let i = 0; i < 40; i++) {
    if (store._ready) return;
    await sleep(500);
  }
  throw new Error('Qdrant 20s 内未就绪');
}

(async () => {
  const vectors = JSON.parse(fs.readFileSync(VECTOR_FILE, 'utf-8'));
  console.log('读取文件向量:', vectors.length, '条');

  const store = new QdrantVectorStore();
  await waitReady(store);
  console.log('Qdrant 就绪, collection:', store.collectionName);

  const already = await store.count().catch(() => 0);
  console.log('当前 collection 已有:', already, '条（跳过已存在的 id）');

  // 逐批 upsert：失败重试（容忍容器自动重启）
  let imported = 0;
  for (let i = 0; i < vectors.length; i += BATCH) {
    const slice = vectors.slice(i, i + BATCH);
    const ids = slice.map(v => v.id);
    const embeddings = slice.map(v => ({ dense: v.dense, sparse: v.sparse || {} }));
    const documents = slice.map(v => v.document || '');
    const metadatas = slice.map(v => v.metadata || {});

    let ok = false;
    for (let attempt = 0; attempt < MAX_RETRY && !ok; attempt++) {
      try {
        await store.addChunks(ids, embeddings, documents, metadatas);
        imported += slice.length;
        ok = true;
        console.log(`已导入 ${imported}/${vectors.length}（批 ${i / BATCH + 1}）`);
      } catch (err) {
        console.log(`  批 ${i / BATCH + 1} 第 ${attempt + 1} 次失败: ${err.message}，${RETRY_MS / 1000}s 后重试...`);
        await sleep(RETRY_MS);
      }
    }
    if (!ok) throw new Error(`批次 ${i / BATCH + 1} 连续失败，中止`);
  }

  const count = await store.count();
  console.log('✅ Qdrant 向量总数:', count, '/', vectors.length);
  if (count < vectors.length) {
    console.log('⚠️ 数量不足，可重跑本脚本（幂等，跳过已存在 id）');
    process.exit(2);
  }
})().catch(err => { console.error('直导失败:', err.message); process.exit(1); });
