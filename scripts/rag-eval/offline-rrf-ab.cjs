/**
 * 离线 A/B：同一查询池下对比「旧加权融合(0.6/0.4)」vs「RRF 融合(多个 k)」的检索指标
 *
 * 与官方 eval-retrieval.js 的区别：只测 vector-store 融合层（不经过 reranker/父段组装/LLM），
 * 因此绝对值不等同于线上评测，但同一批候选上的排序差异能隔离融合方式与 k 的影响。
 *
 * 用法：
 *   cd scripts/rag-eval && node offline-rrf-ab.cjs              # 默认 k=[10,20,40,60]
 *   node offline-rrf-ab.cjs 10 20 40 60                         # 指定 k 列表
 */
"use strict";

const { readFileSync } = require('fs');
const { resolve, dirname } = require('path');
const { config: loadEnv } = require('dotenv');

const ROOT = resolve(__dirname, '..', '..');
// 与 utils/api-client.js 同约定：加载 backend/.env 及根 .env（仅注入环境变量，不输出任何凭据）
loadEnv({ path: resolve(ROOT, 'backend/.env') });
loadEnv({ path: resolve(ROOT, '.env') });
const { VectorStoreService } = require(resolve(ROOT, 'backend/src/services/vector-store.service'));
const { EmbeddingService } = require(resolve(ROOT, 'backend/src/services/embedding.service'));

const DATASET = resolve(__dirname, 'dataset/full-coverage-qa.json');

// k 列表：命令行参数 > 默认 [10, 20, 40, 60]
const K_LIST = process.argv.slice(2).map(Number).filter(n => n > 0).length
  ? process.argv.slice(2).map(Number).filter(n => n > 0)
  : [10, 20, 40, 60];

// ---------- 指标（与 eval-retrieval.js 同口径：doc 级别去重） ----------
function computeDcg(ids, relevantSet, k) {
  return ids.slice(0, k).reduce((s, id, i) => s + (relevantSet.has(id) ? 1 / Math.log2(i + 2) : 0), 0);
}
function computeNdcg(ids, relevantIds, k) {
  const rel = new Set(relevantIds);
  if (!rel.size) return 0;
  const dcg = computeDcg(ids, rel, k);
  const ideal = Array.from({ length: Math.min(rel.size, k) }).reduce((s, _, i) => s + 1 / Math.log2(i + 2), 0);
  return ideal > 0 ? Math.min(dcg / ideal, 1) : 0;
}
function metrics(docOrder, relevantIds) {
  const rel = relevantIds.filter(id => id && !id.startsWith('TODO'));
  if (!rel.length) return null;
  const ids = [...new Set(docOrder)]; // 按 docId 去重
  const set = new Set(ids);
  const hits = rel.filter(id => set.has(id));
  const recall5 = ids.slice(0, 5).filter(id => rel.includes(id)).length / rel.length;
  let mrr = 0;
  for (let i = 0; i < ids.length; i++) {
    if (rel.includes(ids[i])) { mrr = 1 / (i + 1); break; }
  }
  return { hitRate: hits.length > 0 ? 1 : 0, recall5, mrr, ndcg5: computeNdcg(ids, rel, 5) };
}

function aggregate(docs, pickScore) {
  // 句子级 → doc 级：同一 docId 取最高分，保持分数降序
  const best = new Map();
  for (const d of docs) {
    const key = d.docId || d.metadata?.docId || '';
    if (!key) continue;
    const s = pickScore(d);
    const cur = best.get(key);
    if (!cur || s > cur.score) best.set(key, { id: key, score: s });
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

// ---------- 融合实现 ----------
function oldWeightedFusion(all, denseOf, sparseOf, vw = 0.6, sw = 0.4) {
  return aggregate(all, d => vw * denseOf(d) + sw * sparseOf(d));
}
function rrfFusion(all, denseOf, sparseOf, k) {
  // 注意：RRF 排名必须按句子唯一 id（d.id），与 vector-store.service.js 一致；
  // 按 docId 排名会让同一 doc 的句子相互覆盖，rank 被最差句子顶掉，导致 RRF 被低估。
  const rankChannel = (pick) => {
    const ranks = new Map();
    all.filter(d => pick(d) > 0)
      .sort((a, b) => pick(b) - pick(a))
      .forEach((d, i) => ranks.set(d.id, i + 1));
    return ranks;
  };
  const dr = rankChannel(denseOf);
  const sr = rankChannel(sparseOf);
  return aggregate(all, d => {
    let s = 0;
    if (dr.has(d.id)) s += 1 / (k + dr.get(d.id));
    if (sr.has(d.id)) s += 1 / (k + sr.get(d.id));
    return s;
  });
}

// ---------- 主流程 ----------
(async () => {
  const dataset = JSON.parse(readFileSync(DATASET, 'utf-8'));
  const store = new VectorStoreService();
  store._ready = true; // 直接使用已加载的文件数据，不触发重建
  const emb = new EmbeddingService();
  console.log(`向量库: ${store._docs.length} 条 | 评测集: ${dataset.length} 题 | RRF k: ${K_LIST.join('/')}\n`);

  // 累加器：加权 + 每个 k 的 RRF
  const agg = { weighted: { recall5: 0, mrr: 0, ndcg5: 0, hitRate: 0 } };
  for (const k of K_LIST) agg[`k${k}`] = { recall5: 0, mrr: 0, ndcg5: 0, hitRate: 0 };
  let n = 0;
  const better = {}; // 每题加权 vs 各 k 的 recall@5 胜负
  for (const k of K_LIST) better[k] = { w: 0, r: 0 };

  for (const item of dataset) {
    const rel = (item.relevant_doc_ids || []).filter(id => id && !id.startsWith('TODO'));
    if (!rel.length) continue;
    const qEmb = await emb.embedHybrid(item.question);
    if (!qEmb?.dense) { console.log(`  ⏭️  ${item.id} embedding 失败`); continue; }

    const denseOf = d => d.dense ? EmbeddingService.cosineSimilarity(qEmb.dense, d.dense) : 0;
    const sparseOf = d => (qEmb.sparse && d.sparse) ? EmbeddingService.sparseSimilarity(qEmb.sparse, d.sparse) : 0;

    const mWeighted = metrics(oldWeightedFusion(store._docs, denseOf, sparseOf).map(x => x.id), rel);
    if (!mWeighted) continue;
    n++;
    for (const key of ['recall5', 'mrr', 'ndcg5', 'hitRate']) agg.weighted[key] += mWeighted[key];

    const parts = [`${item.id} ${item.question.substring(0, 20)}... | 加权 r5=${mWeighted.recall5.toFixed(2)}`];
    for (const k of K_LIST) {
      const m = metrics(rrfFusion(store._docs, denseOf, sparseOf, k).map(x => x.id), rel);
      for (const key of ['recall5', 'mrr', 'ndcg5', 'hitRate']) agg[`k${k}`][key] += m[key];
      if (m.recall5 > mWeighted.recall5) better[k].r++;
      else if (m.recall5 < mWeighted.recall5) better[k].w++;
      parts.push(`k${k} r5=${m.recall5.toFixed(2)}`);
    }
    console.log(parts.join(' | '));
  }

  const pct = v => (v * 100).toFixed(1) + '%';
  const f3 = v => v.toFixed(3);
  console.log('\n========================================');
  console.log(`有效样本: ${n}`);
  console.log('─────────────────────────────────────────');
  console.log(`指标          加权(0.6/0.4)  ${K_LIST.map(k => `RRF(k=${k})`).join('  ')}`);
  console.log(`Recall@5      ${pct(agg.weighted.recall5 / n)}    ${K_LIST.map(k => pct(agg[`k${k}`].recall5 / n)).join('    ')}`);
  console.log(`MRR           ${f3(agg.weighted.mrr / n)}     ${K_LIST.map(k => f3(agg[`k${k}`].mrr / n)).join('     ')}`);
  console.log(`nDCG@5        ${f3(agg.weighted.ndcg5 / n)}     ${K_LIST.map(k => f3(agg[`k${k}`].ndcg5 / n)).join('     ')}`);
  console.log(`HitRate       ${pct(agg.weighted.hitRate / n)}    ${K_LIST.map(k => pct(agg[`k${k}`].hitRate / n)).join('    ')}`);
  console.log('─────────────────────────────────────────');
  for (const k of K_LIST) {
    console.log(`recall@5 加权胜/平/RRF胜(k=${k}): ${better[k].w} / ${n - better[k].w - better[k].r} / ${better[k].r}`);
  }
})().catch(err => { console.error('A/B 失败:', err); process.exit(1); });
