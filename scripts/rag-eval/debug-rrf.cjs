// 临时调试：验证离线 A/B 中 RRF 劣化的根因
const { config: loadEnv } = require('dotenv');
const { resolve } = require('path');
loadEnv({ path: resolve(__dirname, '../../backend/.env') });
loadEnv({ path: resolve(__dirname, '../../.env') });
const { VectorStoreService } = require(resolve(__dirname, '../../backend/src/services/vector-store.service'));
const { EmbeddingService } = require(resolve(__dirname, '../../backend/src/services/embedding.service'));
const fs = require('fs');

(async () => {
  const store = new VectorStoreService();
  store._ready = true;
  const emb = new EmbeddingService();
  const ds = JSON.parse(fs.readFileSync(resolve(__dirname, 'dataset/full-coverage-qa.json'), 'utf-8'));

  for (const item of ds.filter(q => ['C01', 'C07', 'SE01'].includes(q.id))) {
    const qEmb = await emb.embedHybrid(item.question);
    const rel = new Set(item.relevant_doc_ids);

    const scored = store._docs.map(d => ({
      id: d.id, docId: d.metadata?.docId,
      dense: d.dense ? EmbeddingService.cosineSimilarity(qEmb.dense, d.dense) : 0,
      sparse: (qEmb.sparse && d.sparse) ? EmbeddingService.sparseSimilarity(qEmb.sparse, d.sparse) : 0,
    }));
    const denseSorted = scored.filter(s => s.dense > 0).sort((a, b) => b.dense - a.dense);
    const sparseSorted = scored.filter(s => s.sparse > 0).sort((a, b) => b.sparse - a.sparse);
    const denseRank = new Map(denseSorted.map((s, i) => [s.id, i + 1]));
    const sparseRank = new Map(sparseSorted.map((s, i) => [s.id, i + 1]));
    const K = 60;
    const rrf = scored.map(s => {
      let score = 0;
      if (denseRank.has(s.id)) score += 1 / (K + denseRank.get(s.id));
      if (sparseRank.has(s.id)) score += 1 / (K + sparseRank.get(s.id));
      return { ...s, rrf: score };
    }).sort((a, b) => b.rrf - a.rrf);

    console.log('=== ' + item.id + ' ' + item.question.substring(0, 20) + ' ===');
    console.log('相关doc:', [...rel].map(id => id.substring(0, 8)).join(','));

    const relSentences = rrf.filter(s => rel.has(s.docId));
    console.log('相关句子总数:', relSentences.length);
    if (relSentences.length) {
      // 每个相关 doc 的最佳句子
      const bestByDoc = new Map();
      for (const s of relSentences) {
        const cur = bestByDoc.get(s.docId);
        if (!cur || s.rrf > cur.rrf) bestByDoc.set(s.docId, s);
      }
      for (const [docId, s] of bestByDoc) {
        console.log(`  相关doc ${docId.substring(0,8)}: RRF全局位置=${rrf.indexOf(s)} RRF分=${s.rrf.toFixed(4)} dense分=${s.dense.toFixed(3)}[rank ${denseRank.get(s.id)||'-'}] sparse分=${s.sparse.toFixed(3)}[rank ${sparseRank.get(s.id)||'-'}]`);
      }
    }
    // RRF 前10（全库 doc 去重）
    const top10 = [...new Set(rrf.map(s => s.docId))].slice(0, 10);
    console.log('  RRF全局top10 doc:', top10.map(id => (rel.has(id) ? '✓' : '✗') + id.substring(0, 8)).join(' '));
    // 加权前10
    const weighted = scored.map(s => ({ ...s, w: 0.6 * s.dense + 0.4 * s.sparse })).sort((a, b) => b.w - a.w);
    const wTop10 = [...new Set(weighted.map(s => s.docId))].slice(0, 10);
    console.log('  加权全局top10 doc:', wTop10.map(id => (rel.has(id) ? '✓' : '✗') + id.substring(0, 8)).join(' '));
    // 50句池内相关doc是否存在（模拟 vectorStore.search topK=50 的召回）
    const top50DocIds = new Set(rrf.slice(0, 50).map(s => s.docId));
    console.log('  50句池内相关doc命中:', [...rel].filter(id => top50DocIds.has(id)).length + '/' + rel.size);
  }
})().catch(e => { console.error(e); process.exit(1); });
