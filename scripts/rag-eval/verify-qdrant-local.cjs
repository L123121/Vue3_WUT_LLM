"use strict";
/**
 * 本地 Qdrant 检索链路验证脚本（任务 7）
 * 用法：VECTOR_STORE_BACKEND 无需设置，直接实例化 QdrantVectorStore 指向本地 qdrant
 * 覆盖：addChunks → search（dense+sparse 融合 / filter）→ deleteByDocId → count
 */
process.env.VECTOR_STORE_BACKEND = 'qdrant';
// config 在非 VITEST 环境会强制要求 AI_API_KEY/JWT_SECRET，验证链路不需要 LLM，跳过检查
process.env.VITEST = '1';
process.env.QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';

const path = require('path');
const { QdrantVectorStore } = require(path.resolve(__dirname, '../../backend/src/services/vector-store-qdrant.service'));

async function waitReady(store, ms = 20000) {
  const t0 = Date.now();
  while (!store._ready) {
    if (Date.now() - t0 > ms) throw new Error('store not ready');
    await new Promise(r => setTimeout(r, 200));
  }
}

(async () => {
  const store = new QdrantVectorStore();
  await waitReady(store);
  console.log('✅ 连接 Qdrant:', store.url, '| collection:', store.collectionName);

  // 构造 512 维 dense 向量（与 collection 定义一致；真实 BGE 输出即 512 维）
  const d512 = (hot) => {
    const v = new Array(512).fill(0);
    if (hot === 0) { v[0] = 1; v[1] = 0.5; }
    else if (hot === 1) { v[1] = 1; v[2] = 0.5; }
    else if (hot === 2) { v[2] = 1; v[3] = 0.5; }
    else { v[0] = 0.7; v[1] = 0.7; }
    return v;
  };

  // 1. addChunks（模拟 indexing.service 的元数据）
  await store.addChunks(
    ['doc_a_sent_0', 'doc_a_sent_1', 'doc_b_sent_0'],
    [
      { dense: d512(0), sparse: { 100: 1, 200: 2 } },
      { dense: d512(1), sparse: { 300: 1 } },
      { dense: d512(2), sparse: { 400: 1 } },
    ],
    ['武汉理工大学校训是厚德博学', '图书馆开放时间早八晚十', '离散数学复习笔记'],
    [
      { docId: 'doc_a', parentId: 'doc_a_para_0', parentIdx: 0, parentText: '校训段落', title: '校园手册', category: '学校概况', chunkIndex: 0 },
      { docId: 'doc_a', parentId: 'doc_a_para_1', parentIdx: 1, parentText: '图书馆段落', title: '校园手册', category: '学校概况', chunkIndex: 1 },
      { docId: 'doc_b', parentId: 'doc_b_para_0', parentIdx: 0, parentText: '离散段落', title: '离散笔记', category: '专业课程', chunkIndex: 0 },
    ]
  );
  console.log('✅ addChunks 完成, count =', await store.count());

  // 2. search：dense 命中 c1（cosine 最高）
  const r1 = await store.search({ dense: d512(0), sparse: {} }, 10);
  console.log('✅ search dense: top1 =', r1[0]?.id, '| score =', r1[0]?.score?.toFixed(4), '| channels =', r1[0]?._retrievalChannels?.join(','));
  if (r1[0]?.id !== 'doc_a_sent_0') throw new Error('dense 检索排序错误');

  // 3. search：filter category
  const r2 = await store.search({ dense: d512(0), sparse: {} }, 10, { category: '专业课程' });
  console.log('✅ search filter: top1 =', r2[0]?.id, '| category =', r2[0]?.category);
  if (r2.length !== 1 || r2[0].category !== '专业课程') throw new Error('filter 过滤错误');

  // 4. search：sparse 权重提高后 sparse 命中项排前
  const r3 = await store.search({ dense: d512(3), sparse: { 100: 1, 200: 2 } }, 10, null, { vector: 0.1, sparse: 0.9 });
  console.log('✅ search sparse权重: top1 =', r3[0]?.id, '| _sparseScore =', r3[0]?._sparseScore?.toFixed(4));
  if (r3[0]?.id !== 'doc_a_sent_0') throw new Error('sparse 权重路由错误');

  // 5. deleteByDocId
  await store.deleteByDocId('doc_a');
  const after = await store.count();
  console.log('✅ deleteByDocId 后 count =', after);
  if (after !== 1) throw new Error('deleteByDocId 删除数量错误');

  // 6. resetCollection
  await store.resetCollection();
  console.log('✅ resetCollection 后 count =', await store.count());

  console.log('\n🎉 本地 Qdrant 检索链路验证全部通过');
  process.exit(0);
})().catch(err => {
  console.error('❌ 验证失败:', err.message);
  process.exit(1);
});
