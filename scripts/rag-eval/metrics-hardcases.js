/**
 * 硬用例检索指标评测
 * 指标：来源数、向量分/稀疏分/hybrid分、检索延迟、内容覆盖率
 * 用法: node metrics-hardcases.js
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, 'results/hardcases');
mkdirSync(RESULTS_DIR, { recursive: true });

const BACKEND_URL = 'http://localhost:3000';
// JWT 密钥：环境变量优先，其次读 backend/.env（与后端服务同一密钥）
const SECRET_ENV = resolve(__dirname, '../../backend/.env');
const JWT_SECRET =
  process.env.JWT_SECRET ||
  (existsSync(SECRET_ENV) && readFileSync(SECRET_ENV, 'utf8').match(/^JWT_SECRET=(.+)$/m)?.[1].trim());
if (!JWT_SECRET) {
  console.error('未找到 JWT_SECRET：请设置环境变量 JWT_SECRET，或在 backend/.env 中配置');
  process.exit(1);
}

function makeJwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ ...payload, iat: ~~(Date.now() / 1000), exp: ~~(Date.now() / 1000) + 3600 });
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(h + '.' + p).digest('base64url');
  return h + '.' + p + '.' + sig;
}

const COOKIE = 'auth_token=' + makeJwt({ userId: 'test_eval', username: 'test' });

async function ragQuery(question) {
  const start = Date.now();
  const resp = await fetch(`${BACKEND_URL}/api/rag/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
    body: JSON.stringify({ message: question, history: [] }),
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const text = await resp.text();
  const elapsed = Date.now() - start;

  let answer = '', sources = [], retrieval = null;
  for (const line of text.split('\n').filter(l => l.startsWith('data: '))) {
    const d = line.slice(6).trim();
    if (d === '[DONE]') continue;
    try {
      const p = JSON.parse(d);
      if (p.sources) sources = p.sources;
      if (p.retrieval) retrieval = p.retrieval;
      if (p.content) answer += p.content;
    } catch { /* skip */ }
  }
  return { answer, sources, retrieval, elapsed };
}

// 关键信息标注：每个用例在文档中存在的关键词
const KEY_TERMS = {
  H1: ['湖北工艺学堂', '硅酸盐建筑材料', 'A+', '全国第一'],
  H2: ['最新建设', '硬件条件为全校最优', '图书馆', '7.7万', '370万'],
  H3: ['校训', '厚德博学', '追求卓越', '卓越精神'],
  H4: ['双一流', '材料科学与工程', 'A+', '全国第一'],
  H5: ['甲乙丙丁', '用例图'],
  H6: ['ReAct', '敏捷开发', '迭代'],
  H7: ['反转链表', '递归'],
  H8: ['软件退化', '上下文腐烂', 'Token', 'O(n²)'],
  H9: ['游泳池', '2', '电话'],
  H10: ['zs.whut.edu.cn', '招生信息网', '分数线'],
  H11: ['87652003', '86551120', '校医院'],
  H12: ['感知记忆', 'CLIP', 'CLAP'],
  H13: ['材料科学与工程', 'A+', '全国第一'],
  H14: ['CodeTop', '最长上升子序列', '动态规划'],
  H15: ['厚德博学', '追求卓越'],
  H16: ['递归'],
};

const TEST_CASES = [
  { id: 'H1', title: '材料学科历史渊源', query: '武汉理工大学的材料学科这么强，它的历史渊源是什么？为什么材料学科能成为全国第一？' },
  { id: 'H2', title: '南湖vs余家头图书馆', query: '南湖校区的图书馆和余家头校区的图书馆，哪个更好？' },
  { id: 'H3', title: '卓越与校训关系', query: '武汉理工大学的校园文化里有没有提到"卓越"两个字？和校训有什么关系？' },
  { id: 'H4', title: '双一流学科与排名', query: '武汉理工大学的"双一流"建设学科是什么？它在全国排第几？' },
  { id: 'H5', title: '围棋题+用例图建模', query: '离散数学里那个"甲乙丙丁围棋比赛"的逻辑题，如果用软件工程里的"用例图"来分析，应该怎么建模？' },
  { id: 'H6', title: 'ReAct vs 敏捷开发', query: 'Agent 学习笔记里说的"ReAct 范式"和软件工程里的"敏捷开发"在迭代思路上有什么异同？' },
  { id: 'H7', title: '反转链表与递归定义', query: 'CodeTop 里的"反转链表"和离散数学里的"递归定义"有什么关系？' },
  { id: 'H8', title: '软件退化 vs 上下文腐烂', query: '软件工程里说"软件会逐渐退化"，能不能用 Agent 学习笔记里提到的"上下文腐烂"来解释？' },
  { id: 'H9', title: '南湖有游泳馆吗', query: '武汉理工大学南湖校区有没有游泳馆？' },
  { id: 'H10', title: '2024录取分数线', query: '武汉理工大学 2024 年的录取分数线是多少？' },
  { id: 'H11', title: '校医院开门吗', query: '武汉理工大学的校医院晚上开门吗？' },
  { id: 'H12', title: '多模态在哪一页', query: 'Agent 学习笔记里有提到"多模态"吗？具体在哪一页？' },
  { id: 'H13', title: '"材料"是什么', query: '理工大学的"材料"是什么？' },
  { id: 'H14', title: '最长上升子序列在哪', query: '那个"最长上升子序列"在离散数学里有吗？' },
  { id: 'H15', title: '校训出现次数', query: '武汉理工大学的"校训"在校园手册里出现了几次？都在哪些地方？' },
  { id: 'H16', title: '递归跨文档统计', query: 'Agent 学习笔记、软件工程、离散数学，这三份文档里，哪一份提到"递归"最多？' },
];

async function main() {
  // 1. 获取当前文档列表
  const docResp = await fetch(`${BACKEND_URL}/api/rag/documents`, { headers: { Cookie: COOKIE } });
  const docData = await docResp.json();
  const docs = docData.data?.documents || [];
  const docMap = {};
  docs.forEach(d => { docMap[d.id] = d.title; });
  console.log(`📚 知识库文档 (${docs.length}):`);
  docs.forEach(d => console.log(`   ${d.id.substring(0, 20)}...  ${d.title} [${d.category}]`));

  // 2. 逐条跑查询
  const rows = [];

  for (const tc of TEST_CASES) {
    process.stdout.write(`\n${tc.id} ${tc.title}... `);
    try {
      const { answer, sources, retrieval, elapsed } = await ragQuery(tc.query);

      const srcTitles = [...new Set(sources.map(s => s.title))];
      const srcIds = [...new Set(sources.map(s => s.id))];

      // 汇总得分
      const scores = sources.map(s => ({
        title: s.title,
        hybrid: s.hybridScore ?? 0,
        vector: s.vectorScore ?? 0,
        sparse: s.sparseScore ?? 0,
        keyword: s.keywordScore ?? 0,
        chunks: s.matchedChunks ?? 0,
      }));

      const avgHybrid = scores.length > 0 ? scores.reduce((a, s) => a + s.hybrid, 0) / scores.length : 0;
      const maxHybrid = scores.length > 0 ? Math.max(...scores.map(s => s.hybrid)) : 0;
      const totalChunks = scores.reduce((a, s) => a + s.chunks, 0);

      // 内容覆盖率：回答中包含多少预期关键词
      const terms = KEY_TERMS[tc.id] || [];
      const answerLower = (answer || '').toLowerCase();
      const matchedTerms = terms.filter(t => answerLower.includes(t.toLowerCase()));
      const coverage = terms.length > 0 ? matchedTerms.length / terms.length : 1;

      // 来源文档多样性
      const docDiversity = srcIds.length;

      // 拒绝检测
      const refused = /没有检索到|知识库中没有|无法回答|知识库资料不足/.test(answer || '');

      // 回答长度
      const answerLen = (answer || '').length;

      const row = {
        id: tc.id,
        elapsed,
        answerLen,
        srcCount: sources.length,
        docDiversity,
        avgHybrid: +avgHybrid.toFixed(4),
        maxHybrid: +maxHybrid.toFixed(4),
        totalMatchedChunks: totalChunks,
        srcTitles: srcTitles.join('; '),
        contentCoverage: +coverage.toFixed(2),
        matchedTerms,
        missingTerms: terms.filter(t => !answerLower.includes(t.toLowerCase())),
        refused,
        retrieval,
      };
      rows.push(row);

      const status = row.refused ? '🟥' : row.contentCoverage < 0.5 ? '🟨' : '🟩';
      console.log(`${status} ${elapsed}ms | ${srcCount=sources.length}源 | coverage=${(coverage*100).toFixed(0)}% | avgHybrid=${avgHybrid.toFixed(3)}`);
    } catch (err) {
      console.log(`💥 ${err.message}`);
      rows.push({ id: tc.id, elapsed: -1, srcCount: 0, docDiversity: 0, avgHybrid: 0, maxHybrid: 0, totalMatchedChunks: 0, srcTitles: '', contentCoverage: 0, matchedTerms: [], missingTerms: [], refused: true, error: err.message });
    }
  }

  // 3. 汇总统计
  const valids = rows.filter(r => r.elapsed > 0);
  const avgElapsed = valids.reduce((a, r) => a + r.elapsed, 0) / valids.length;
  const avgCoverage = valids.reduce((a, r) => a + r.contentCoverage, 0) / valids.length;
  const avgSources = valids.reduce((a, r) => a + r.srcCount, 0) / valids.length;
  const avgHybrid = valids.reduce((a, r) => a + r.avgHybrid, 0) / valids.length;
  const refusedCount = valids.filter(r => r.refused).length;
  const lowCoverage = valids.filter(r => r.contentCoverage < 0.5).length;
  const singleSource = valids.filter(r => r.docDiversity < 2).length;

  // 4. 输出报告
  console.log('\n\n' + '═'.repeat(80));
  console.log('📊 硬用例检索指标报告');
  console.log('═'.repeat(80));
  console.log(`知识库文档: ${docs.length} | 测试用例: ${TEST_CASES.length} | 有效: ${valids.length}`);
  console.log('');
  console.log('── 总体指标 ──');
  console.log(`  平均耗时:         ${avgElapsed.toFixed(0)}ms`);
  console.log(`  平均内容覆盖率:   ${(avgCoverage * 100).toFixed(1)}%`);
  console.log(`  平均来源数:       ${avgSources.toFixed(1)} 个`);
  console.log(`  平均 Hybrid 分:   ${avgHybrid.toFixed(4)}`);
  console.log(`  拒绝回答:         ${refusedCount}/${valids.length}`);
  console.log(`  低覆盖率(<50%):   ${lowCoverage}/${valids.length}`);
  console.log(`  单文档来源:       ${singleSource}/${valids.length}`);

  console.log('\n── 逐用例指标 ──');
  console.log('ID   | 耗时   | 来源 | 文档 | avgHybrid | maxHybrid | 覆盖率 | 缺席关键词');
  console.log('─'.repeat(90));
  for (const r of rows) {
    const missing = r.missingTerms?.slice(0, 4).join(', ') || '-';
    const flag = r.refused ? '🟥' : r.contentCoverage < 0.5 ? '🟨' : '🟩';
    console.log(`${flag}${r.id.padEnd(4)}| ${(r.elapsed+'ms').padStart(6)}| ${(r.srcCount+'个').padStart(4)}| ${(r.docDiversity+'个').padStart(4)}| ${(r.avgHybrid+'').padStart(9)}| ${(r.maxHybrid+'').padStart(9)}| ${(r.contentCoverage*100+'%').padStart(6)}| ${missing.substring(0, 60)}`);
  }

  console.log('\n── 来源文档明细 ──');
  for (const r of rows) {
    if (r.srcTitles) console.log(`  ${r.id}: ${r.srcTitles}`);
    else if (r.refused) console.log(`  ${r.id}: (无来源 / 拒绝)`);
  }

  // 5. 分类 Badcase 类型
  console.log('\n── Badcase 分类诊断 ──');
  for (const r of rows) {
    if (r.refused) {
      console.log(`  🟥 ${r.id} 拒绝回答 (检索失败导致 LLM 拒答)`);
    } else if (r.contentCoverage < 0.5) {
      console.log(`  🟨 ${r.id} 内容覆盖不足 (${(r.contentCoverage*100).toFixed(0)}%) 缺: ${r.missingTerms?.join(', ')}`);
    } else if (r.docDiversity < 2 && (r.id.match(/^H[5-8]$|H14|H16/))) {
      console.log(`  🟨 ${r.id} 跨文档仅命中 ${r.docDiversity} 个来源`);
    } else {
      console.log(`  🟩 ${r.id} 通过`);
    }
  }

  // 6. 保存结果
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const output = {
    timestamp: ts,
    docCount: docs.length,
    documents: docs.map(d => ({ id: d.id, title: d.title, category: d.category })),
    overall: {
      avgElapsed: +avgElapsed.toFixed(0),
      avgCoverage: +(avgCoverage * 100).toFixed(1),
      avgSources: +avgSources.toFixed(1),
      avgHybrid: +avgHybrid.toFixed(4),
      refusedCount,
      lowCoverageCount: lowCoverage,
      singleSourceCount: singleSource,
    },
    rows,
  };
  const jsonPath = resolve(RESULTS_DIR, `metrics-${ts}.json`);
  writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  console.log(`\n💾 完整数据: ${jsonPath}`);
}

main().catch(e => { console.error(`\n💥 ${e.message}`); process.exit(1); });
