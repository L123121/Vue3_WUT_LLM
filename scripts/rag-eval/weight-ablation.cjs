// 权重消融实验：遍历稠密/稀疏权重组合，对比 Recall@5 / MRR / HitRate@5
// 复用项目现有内存向量库（backend/data/vectors.json）与本地 BGE-small-zh
require('dotenv').config({ path: require('path').resolve(__dirname, '../../backend/.env') });
const { EmbeddingService } = require('../../backend/src/services/embedding.service');
const { vectorStore } = require('../../backend/src/services/vector-store.service');
const fs = require('fs');
const path = require('path');

(async () => {
  await vectorStore.ensureReady();
  const emb = new EmbeddingService();
  const dataset = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'dataset/campus-qa.json'), 'utf-8'));

  // 先对所有 query 编码一次（dense + sparse），后续遍历权重只重算融合分数
  const queries = [];
  for (const item of dataset) {
    const relevant = (item.relevant_doc_ids || []).filter(id => id && !id.startsWith('TODO'));
    if (!relevant.length) continue;
    const qEmb = await emb.embedHybrid(item.question);
    queries.push({ item, relevant, qEmb });
  }
  console.log(`有效测试 query: ${queries.length} 条\n`);

  const weightSets = [
    [0.0, 1.0], [0.2, 0.8], [0.4, 0.6], [0.5, 0.5],
    [0.6, 0.4], [0.7, 0.3], [0.8, 0.2], [1.0, 0.0]
  ];

  const rows = [];
  for (const [vw, sw] of weightSets) {
    let recall5 = 0, mrr = 0, hit = 0;
    for (const { item, relevant, qEmb } of queries) {
      const results = await vectorStore.search(qEmb, 50, null, { vector: vw, sparse: sw });
      const docIds = [...new Set(results.map(r => r.docId).filter(Boolean))];
      const top5 = docIds.slice(0, 5);
      const hitCount = relevant.filter(id => top5.includes(id)).length;
      recall5 += hitCount / relevant.length;
      hit += hitCount > 0 ? 1 : 0;
      let rr = 0;
      for (let i = 0; i < top5.length; i++) {
        if (relevant.includes(top5[i])) { rr = 1 / (i + 1); break; }
      }
      mrr += rr;
    }
    const n = queries.length;
    const row = {
      稠密: vw, 稀疏: sw,
      'Recall@5': +(recall5 / n * 100).toFixed(1),
      MRR: +(mrr / n).toFixed(4),
      'HitRate@5': +(hit / n * 100).toFixed(1),
    };
    rows.push(row);
    console.log(`权重[稠密=${vw}, 稀疏=${sw}]  Recall@5=${row['Recall@5']}%  MRR=${row.MRR}  HitRate@5=${row['HitRate@5']}%`);
  }

  // 输出 Markdown 表格（便于写回笔记）
  console.log('\n===== Markdown 表格 =====');
  console.log('| 稠密权重 | 稀疏权重 | Recall@5 | MRR | HitRate@5 |');
  console.log('|:---:|:---:|:---:|:---:|:---:|');
  for (const r of rows) {
    console.log(`| ${r['稠密']} | ${r['稀疏']} | ${r['Recall@5']}% | ${r.MRR} | ${r['HitRate@5']}% |`);
  }
})().catch(err => {
  console.error('实验失败:', err);
  process.exit(1);
});
