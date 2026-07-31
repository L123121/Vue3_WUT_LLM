// rebuild-vectors.js — 手动触发向量重建（修复向量为空的 bug）
// 用法: 在服务器运行时 node rebuild-vectors.js

async function main() {
  console.log('=== 向量重建脚本 ===');

  // 加载服务（和服务器相同的环境）
  const { redis: store } = require('./backend/src/services/memory-store');
  const { vectorStore, registerDocumentProvider } = require('./backend/src/services/vector-store.service');
  const { IndexingService } = require('./backend/src/services/indexing.service');
  const { EmbeddingService } = require('./backend/src/services/embedding.service');

  // 手动注册 documentProvider（修复延迟初始化 bug）
  registerDocumentProvider(async () => {
    const docIds = await store.smembers('documents:all');
    const pipeline = store.pipeline();
    docIds.forEach(id => pipeline.hgetall(`document:${id}`));
    const results = await pipeline.exec();
    return results
      .map(([, data]) => data)
      .filter(d => d && d.id)
      .map(d => ({ id: d.id, title: d.title, content: d.content, category: d.category }));
  });

  // 获取文档
  const docs = await store.smembers('documents:all');
  console.log(`文档库有 ${docs.length} 个文档 ID`);

  // 触发重建
  await vectorStore.ensureReady();

  console.log(`向量库就绪，共 ${vectorStore._docs.length} 条向量`);

  // 如果没有向量，强制重建
  if (vectorStore._docs.length === 0) {
    console.log('向量为空，开始重建...');
    const embeddingService = new EmbeddingService();
    await embeddingService.ensureReady();
    const indexing = new IndexingService(vectorStore, embeddingService);

    const allDocs = await (async () => {
      const docIds = await store.smembers('documents:all');
      const pipeline = store.pipeline();
      docIds.forEach(id => pipeline.hgetall(`document:${id}`));
      const results = await pipeline.exec();
      return results
        .map(([, data]) => data)
        .filter(d => d && d.id)
        .map(d => ({ id: d.id, title: d.title, content: d.content, category: d.category }));
    })();

    console.log(`读取到 ${allDocs.length} 个文档`);
    const total = await indexing.reindexAll(allDocs);
    console.log(`重建完成，共 ${total} 个向量`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('失败:', err.message);
  process.exit(1);
});
