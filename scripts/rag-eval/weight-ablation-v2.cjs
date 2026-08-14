// 权重消融实验 v2：按问题类别拆分 + 首个相关排名，验证语义/精确场景下的权重表现
require('dotenv').config({ path: require('path').resolve(__dirname, '../../backend/.env') });
const { EmbeddingService } = require('../../backend/src/services/embedding.service');
const { vectorStore } = require('../../backend/src/services/vector-store.service');
const fs = require('fs');
const path = require('path');

(async () => {
  await vectorStore.ensureReady();
  const emb = new EmbeddingService();
  const dataset = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'dataset/campus-qa.json'), 'utf-8'));

  const queries = [];
  for (const item of dataset) {
    const relevant = (item.relevant_doc_ids || []).filter(id => id && !id.startsWith('TODO'));
    if (!relevant.length) continue;
    const qEmb = await emb.embedHybrid(item.question);
    queries.push({ item, relevant, qEmb });
  }
  console.log(`有效测试 query: ${queries.length} 条`);
  const cats = [...new Set(queries.map(q => q.item.category || '未知'))];
  console.log(`类别: ${cats.join(' / ')}\n`);

  const weightSets = [
    [0.2, 0.8], [0.4, 0.6], [0.5, 0.5], [0.6, 0.4], [0.7, 0.3], [0.8, 0.2]
  ];

  for (const [vw, sw] of weightSets) {
    const byCat = {};
    let avgRankSum = 0;
    for (const { item, relevant, qEmb } of queries) {
      const results = await vectorStore.search(qEmb, 50, null, { vector: vw, sparse: sw });
      const docIds = [...new Set(results.map(r => r.docId).filter(Boolean))];
      const hitCount = relevant.filter(id => docIds.slice(0, 5).includes(id)).length;
      let firstRank = 0;
      for (let i = 0; i < docIds.length; i++) {
        if (relevant.includes(docIds[i])) { firstRank = i + 1; break; }
      }
      avgRankSum += firstRank;
      const cat = item.category || '未知';
      if (!byCat[cat]) byCat[cat] = { n: 0, hit: 0, mrr: 0 };
      byCat[cat].n++;
      byCat[cat].hit += hitCount > 0 ? 1 : 0;
      if (firstRank > 0) byCat[cat].mrr += 1 / firstRank;
    }
    const n = queries.length;
    const avgRank = (avgRankSum / n).toFixed(2);
    const catStr = Object.entries(byCat).map(([c, s]) => {
      const recall = (s.hit / s.n * 100).toFixed(0);
      const mrr = (s.mrr / s.n).toFixed(3);
      return `${c}: ${s.n}题 recall=${recall}% mrr=${mrr}`;
    }).join('  ');
    console.log(`[稠密=${vw}, 稀疏=${sw}]  平均首个相关排名=${avgRank}   ${catStr}`);
  }
})().catch(err => { console.error('实验失败:', err); process.exit(1); });
