// 权重消融实验 v3：合并新增测试集 full-coverage-qa + qa，覆盖多类别与拒答场景
// 兼容两种 docId 标注：完整 UUID 与截断前缀（qa.json 用 doc_xxxx 前缀）
require('dotenv').config({ path: require('path').resolve(__dirname, '../../backend/.env') });
const { EmbeddingService } = require('../../backend/src/services/embedding.service');
const { vectorStore } = require('../../backend/src/services/vector-store.service');
const fs = require('fs');
const path = require('path');

const datasetDir = path.resolve(__dirname, 'dataset');

// 加载并合并数据集
function loadSet(file) {
  const d = JSON.parse(fs.readFileSync(path.join(datasetDir, file), 'utf-8'));
  return Array.isArray(d) ? d : (d.data || []);
}
const allData = [
  ...loadSet('full-coverage-qa.json'),
  ...loadSet('qa.json'),
  ...loadSet('campus-qa.json'),
];

(async () => {
  await vectorStore.ensureReady();
  const emb = new EmbeddingService();

  // 预处理：编码 query，构建 relevant 匹配函数（完整 ID 或前缀）
  const queries = [];
  for (const item of allData) {
    const rel = (item.relevant_doc_ids || []).filter(id => id && !id.startsWith('TODO'));
    if (!rel.length) continue;
    const qEmb = await emb.embedHybrid(item.question);
    queries.push({ item, rel, qEmb });
  }
  console.log(`合并测试 query: ${queries.length} 条\n`);

  const weightSets = [
    [0.0, 1.0], [0.2, 0.8], [0.4, 0.6], [0.5, 0.5],
    [0.6, 0.4], [0.7, 0.3], [0.8, 0.2], [1.0, 0.0]
  ];

  const rows = [];
  const byCatRows = [];
  for (const [vw, sw] of weightSets) {
    let recall5 = 0, mrr = 0, hit = 0;
    const byCat = {};
    for (const { item, rel, qEmb } of queries) {
      const results = await vectorStore.search(qEmb, 50, null, { vector: vw, sparse: sw });
      const docIds = [...new Set(results.map(r => r.docId).filter(Boolean))];
      // 匹配：完整 ID 相等，或截断前缀命中
      const isRel = id => rel.some(r => id === r || id.startsWith(r));
      const top5 = docIds.slice(0, 5);
      const hitCount = rel.filter(r => top5.some(id => id === r || id.startsWith(r))).length;
      recall5 += hitCount / rel.length;
      hit += hitCount > 0 ? 1 : 0;
      let rr = 0;
      for (let i = 0; i < docIds.length; i++) {
        if (isRel(docIds[i])) { rr = 1 / (i + 1); break; }
      }
      mrr += rr;

      const cat = item.category || '未知';
      if (!byCat[cat]) byCat[cat] = { n: 0, hit: 0, mrr: 0 };
      byCat[cat].n++;
      byCat[cat].hit += hitCount > 0 ? 1 : 0;
      byCat[cat].mrr += rr;
    }
    const n = queries.length;
    const row = {
      稠密: vw, 稀疏: sw,
      'Recall@5': +(recall5 / n * 100).toFixed(1),
      MRR: +(mrr / n).toFixed(4),
      'HitRate@5': +(hit / n * 100).toFixed(1),
    };
    rows.push(row);
    const catStr = Object.entries(byCat).map(([c, s]) =>
      `${c}:${s.n}题 recall=${(s.hit / s.n * 100).toFixed(0)}% mrr=${(s.mrr / s.n).toFixed(3)}`
    ).join('  ');
    byCatRows.push({ vw, sw, catStr });
    console.log(`权重[稠密=${vw}, 稀疏=${sw}]  Recall@5=${row['Recall@5']}%  MRR=${row.MRR}  HitRate@5=${row['HitRate@5']}%`);
    console.log(`    ${catStr}`);
  }

  console.log('\n===== Markdown 表格（总览）=====');
  console.log('| 稠密权重 | 稀疏权重 | Recall@5 | MRR | HitRate@5 |');
  console.log('|:---:|:---:|:---:|:---:|:---:|');
  for (const r of rows) {
    console.log(`| ${r['稠密']} | ${r['稀疏']} | ${r['Recall@5']}% | ${r.MRR} | ${r['HitRate@5']}% |`);
  }
  console.log('\n===== 按类别（稠密=0.6 与对比组）=====');
  for (const r of byCatRows) {
    if (r.vw === 0.6 || r.vw === 0.4 || r.vw === 0.8 || r.vw === 0.2) {
      console.log(`[${r.vw}/${r.sw}] ${r.catStr}`);
    }
  }
})().catch(err => { console.error('实验失败:', err); process.exit(1); });
