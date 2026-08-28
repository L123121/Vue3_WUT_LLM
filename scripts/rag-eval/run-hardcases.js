/**
 * 高难度 Badcase 测试脚本
 *
 * 绕过登录：直接用 JWT_SECRET 生成 auth_token cookie
 * 用法: node run-hardcases.js [--filter H1,H2] [--sample N]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, 'results/hardcases');
mkdirSync(RESULTS_DIR, { recursive: true });

// ── 配置 ──
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
// JWT 密钥：环境变量优先，其次读 backend/.env（与后端服务同一密钥）
const SECRET_ENV = resolve(__dirname, '../../backend/.env');
const JWT_SECRET =
  process.env.JWT_SECRET ||
  (existsSync(SECRET_ENV) && readFileSync(SECRET_ENV, 'utf8').match(/^JWT_SECRET=(.+)$/m)?.[1].trim());
if (!JWT_SECRET) {
  console.error('未找到 JWT_SECRET：请设置环境变量 JWT_SECRET，或在 backend/.env 中配置');
  process.exit(1);
}

// 手动生成 JWT（无需 jsonwebtoken 依赖）
function makeJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const headerB64 = b64(header);
  const payloadB64 = b64({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
  const signature = crypto.createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

const token = makeJwt({ userId: 'test_eval', username: 'test' }, JWT_SECRET);
const COOKIE = `auth_token=${token}`;

// ── API 调用 ──
async function ragQuery(question, options = {}) {
  const response = await fetch(`${BACKEND_URL}/api/rag/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: COOKIE,
    },
    body: JSON.stringify({
      message: question,
      history: [],
      category: options.category || undefined,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`RAG API 请求失败: ${response.status} ${errText.substring(0, 200)}`);
  }

  const text = await response.text();
  const lines = text.split('\n').filter(line => line.startsWith('data: '));

  let answer = '';
  let sources = [];
  let retrieval = null;

  for (const line of lines) {
    const data = line.slice(6).trim();
    if (data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed.sources) sources = parsed.sources;
      if (parsed.retrieval) retrieval = parsed.retrieval;
      if (parsed.content) answer += parsed.content;
      if (parsed.error) throw new Error(`RAG 返回错误: ${parsed.error}`);
    } catch (e) {
      if (e.message.includes('RAG 返回错误')) throw e;
    }
  }

  return { answer, sources, retrieval };
}

// ── 测试用例定义 ──
const TEST_CASES = [
  {
    id: 'H1', type: '隐式推理', difficulty: '⭐⭐⭐⭐⭐',
    title: '材料学科历史渊源与强的原因',
    query: '武汉理工大学的材料学科这么强，它的历史渊源是什么？为什么材料学科能成为全国第一？',
    expected: ['湖北工艺学堂', '三校合并', '硅酸盐建筑材料国家重点实验室', '材料复合新技术国家重点实验室', 'A+', '全国第一'],
    warnings: ['只回答历史没回答"为什么强"', '找不到实验室信息', '混淆两个实验室'],
  },
  {
    id: 'H2', type: '隐式推理', difficulty: '⭐⭐⭐⭐',
    title: '南湖校区 vs 余家头校区图书馆对比',
    query: '南湖校区的图书馆和余家头校区的图书馆，哪个更好？',
    expected: ['最新建设', '硬件条件最优', '7.7万', '370万'],
    warnings: ['未做推断直接拒绝', '无比较结论', '把馆藏总量当单个数据'],
  },
  {
    id: 'H3', type: '隐式推理', difficulty: '⭐⭐⭐⭐',
    title: '校园文化中的"卓越"与校训关系',
    query: '武汉理工大学的校园文化里有没有提到"卓越"两个字？和校训有什么关系？',
    expected: ['厚德博学', '追求卓越', '卓越精神', '校园文化'],
    warnings: ['只在校训找到没在校园文化找到', '没区分校训和校园精神'],
  },
  {
    id: 'H4', type: '隐式推理', difficulty: '⭐⭐⭐',
    title: '双一流建设学科与排名',
    query: '武汉理工大学的"双一流"建设学科是什么？它在全国排第几？',
    expected: ['材料科学与工程', 'A+', '全国第一'],
    warnings: ['漏掉排名', '误答为双一流建设高校'],
  },
  {
    id: 'H5', type: '跨文档', difficulty: '⭐⭐⭐⭐⭐',
    title: '离散数学围棋题 + 软件工程用例图建模',
    query: '离散数学里那个"甲乙丙丁围棋比赛"的逻辑题，如果用软件工程里的"用例图"来分析，应该怎么建模？',
    expected: ['甲乙丙丁', '用例图', '参与者', 'actor', '约束'],
    warnings: ['只检索到一个文档', '只讲定义没建模', '强行建模没指出不适用'],
  },
  {
    id: 'H6', type: '跨文档', difficulty: '⭐⭐⭐⭐⭐',
    title: 'ReAct 范式 vs 敏捷开发',
    query: 'Agent 学习笔记里说的"ReAct 范式"和软件工程里的"敏捷开发"在迭代思路上有什么异同？',
    expected: ['ReAct', '敏捷开发', '迭代'],
    warnings: ['只找到 ReAct', '拒绝跨文档', '混淆概念'],
  },
  {
    id: 'H7', type: '跨文档', difficulty: '⭐⭐⭐⭐',
    title: '反转链表与递归定义',
    query: 'CodeTop 里的"反转链表"和离散数学里的"递归定义"有什么关系？',
    expected: ['反转链表', '递归', 'CodeTop', '离散数学'],
    warnings: ['没建立关联', '只讲算法不讲师数学'],
  },
  {
    id: 'H8', type: '跨文档', difficulty: '⭐⭐⭐⭐',
    title: '软件退化 vs 上下文腐烂',
    query: '软件工程里说"软件会逐渐退化"，能不能用 Agent 学习笔记里提到的"上下文腐烂"来解释？',
    expected: ['软件退化', '上下文腐烂', 'Token', 'O(n²)'],
    warnings: ['找到概念没建立类比', '混淆两个概念'],
  },
  {
    id: 'H9', type: '边界压力', difficulty: '⭐⭐⭐⭐',
    title: '南湖校区有游泳馆吗？',
    query: '武汉理工大学南湖校区有没有游泳馆？',
    expected: ['游泳池', '2', '推理'],
    warnings: ['直接回答有或没有', '把2个游泳池当南湖有', '拒绝回答'],
  },
  {
    id: 'H10', type: '边界压力', difficulty: '⭐⭐⭐',
    title: '2024 录取分数线',
    query: '武汉理工大学 2024 年的录取分数线是多少？',
    expected: ['zs.whut.edu.cn', '招生信息网', '查询', '没有具体'],
    warnings: ['编造分数线', '简单说没找到', '误答招生人数'],
  },
  {
    id: 'H11', type: '边界压力', difficulty: '⭐⭐⭐',
    title: '校医院晚上开门吗？',
    query: '武汉理工大学的校医院晚上开门吗？',
    expected: ['87652003', '86551120', '咨询', '电话'],
    warnings: ['编造24小时营业', '直接说不清楚没建议'],
  },
  {
    id: 'H12', type: '边界压力', difficulty: '⭐⭐⭐⭐',
    title: '多模态在哪一页',
    query: 'Agent 学习笔记里有提到"多模态"吗？具体在哪一页？',
    expected: ['感知记忆', 'Perceptual', 'CLIP', 'CLAP', '第八章'],
    warnings: ['答没有提到', '忽略感知记忆', '编造页码'],
  },
  {
    id: 'H13', type: '语义模糊', difficulty: '⭐⭐⭐⭐',
    title: '"材料"歧义处理',
    query: '理工大学的"材料"是什么？',
    expected: ['材料科学与工程', '歧义', 'A+', '全国第一'],
    warnings: ['没处理歧义', '只回答校园资料', '不澄清'],
  },
  {
    id: 'H14', type: '语义模糊', difficulty: '⭐⭐⭐⭐',
    title: '最长上升子序列在离散数学里？',
    query: '那个"最长上升子序列"在离散数学里有吗？',
    expected: ['CodeTop', '动态规划', '300', '离散数学没有'],
    warnings: ['离散数学搜不到就拒绝', '没跨文档检索', '没指出文档来源'],
  },
  {
    id: 'H15', type: '顺序/优先级', difficulty: '⭐⭐⭐⭐',
    title: '校训出现次数和位置',
    query: '武汉理工大学的"校训"在校园手册里出现了几次？都在哪些地方？',
    expected: ['厚德博学', '追求卓越', '3', '学校概况', '校园文化', '末尾'],
    warnings: ['只找到一次', '遗漏末尾', '统计不完整'],
  },
  {
    id: 'H16', type: '跨文档', difficulty: '⭐⭐⭐⭐⭐',
    title: '跨文档递归词频统计',
    query: 'Agent 学习笔记、软件工程、离散数学，这三份文档里，哪一份提到"递归"最多？',
    expected: ['离散数学', 'CodeTop', '递归'],
    warnings: ['只在一个文档搜', '没理解含义不同', '统计不完整'],
  },
];

// ── 分析函数 ──
function analyzeResult(id, answer, sources) {
  const tc = TEST_CASES.find(c => c.id === id);
  if (!tc) return { issues: [] };

  const issues = [];
  const a = (answer || '').toLowerCase();

  // 检查 expected 关键词覆盖率
  const missingExpected = tc.expected.filter(k => !a.includes(k.toLowerCase()));
  if (missingExpected.length > 0) {
    issues.push(`❌ 缺少预期关键词: ${missingExpected.join(', ')}`);
  }

  // 检查 refusal 信号
  const refusalSignals = ['无法回答', '没有相关信息', '无法提供', '我不清楚', '没有找到', '抱歉'];
  const hasRefusal = refusalSignals.some(s => a.includes(s) && !a.includes('建议') && !a.includes('咨询') && !a.includes('查询'));
  // H9/H10/H11 的 refusal 要看是否带了建议，不算 Badcase
  const acceptableRefusal = (id === 'H9' || id === 'H10' || id === 'H11');
  if (hasRefusal && !acceptableRefusal) {
    issues.push('⚠️ 疑似拒绝回答');
  }

  // 检查幻觉信号（具体数字编造）
  if (id === 'H10' && /\d{4}年/.test(answer) && !/zs\.whut/.test(answer)) {
    issues.push('⚠️ 可能编造分数线');
  }
  if (id === 'H11' && /24小时/.test(answer)) {
    issues.push('⚠️ 可能编造24小时营业');
  }

  // 来源分析
  if (sources && sources.length === 0) {
    issues.push('⚠️ 无检索来源');
  }
  if (sources && sources.length > 0) {
    const uniqueDocs = new Set(sources.map(s => s.title || s.docId));
    if (id.startsWith('H5') || id.startsWith('H6') || id.startsWith('H7') || id.startsWith('H8') || id === 'H14' || id === 'H16') {
      if (uniqueDocs.size < 2) {
        issues.push(`⚠️ 跨文档用例但来源只有 ${uniqueDocs.size} 个文档`);
      }
    }
  }

  return issues;
}

// ── 主流程 ──
async function main() {
  const args = process.argv.slice(2);
  const filterIdx = args.indexOf('--filter');
  const filter = filterIdx >= 0 ? args[filterIdx + 1]?.split(',') : null;
  const sampleIdx = args.indexOf('--sample');
  const sampleSize = sampleIdx >= 0 ? parseInt(args[sampleIdx + 1]) || 0 : 0;

  let cases = TEST_CASES;
  if (filter) {
    cases = cases.filter(c => filter.includes(c.id));
    console.log(`🔍 过滤模式: 仅运行 ${filter.join(', ')}\n`);
  }
  if (sampleSize > 0) {
    cases = cases.slice(0, sampleSize);
    console.log(`🔍 采样模式: 仅前 ${sampleSize} 条\n`);
  }

  // 健康检查
  try {
    const h = await fetch(`${BACKEND_URL}/api/health`);
    if (!h.ok) throw new Error(`health 返回 ${h.status}`);
    console.log(`✅ 后端正常: ${BACKEND_URL}\n`);
  } catch (e) {
    console.error(`❌ 后端不可达: ${e.message}`);
    process.exit(1);
  }

  const results = [];
  let passCount = 0, totalIssues = 0;

  for (const tc of cases) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 ${tc.id} [${tc.type}] ${tc.title}`);
    console.log(`💬 ${tc.query}`);
    console.log(`🎯 难度: ${tc.difficulty}`);
    console.log(`⚠️  关注: ${tc.warnings.join(' | ')}`);
    console.log('-'.repeat(60));

    let result;
    try {
      const start = Date.now();
      const { answer, sources, retrieval } = await ragQuery(tc.query);
      const elapsed = Date.now() - start;

      console.log(`⏱️  ${elapsed}ms`);
      console.log(`📝 回答 (前 300 字):\n${(answer || '').substring(0, 300)}`);
      if ((answer || '').length > 300) console.log('   ...(截断)');

      if (retrieval) {
        const parentCount = retrieval.parentCandidates?.length || retrieval.candidates?.length || 0;
        console.log(`🔍 检索候选: ${parentCount} 个父段`);
      }

      if (sources && sources.length > 0) {
        const uniqueDocs = [...new Set(sources.map(s => s.title || ''))];
        console.log(`📚 来源文档: ${uniqueDocs.join(', ')}`);
      }

      const issues = analyzeResult(tc.id, answer, sources);
      totalIssues += issues.length;
      const isPass = issues.length === 0;

      if (isPass) {
        passCount++;
        console.log(`\n✅ 通过 (${tc.id})`);
      } else {
        console.log(`\n❌ Badcase! (${tc.id})`);
        issues.forEach(i => console.log(`   ${i}`));
      }

      result = { ...tc, answer, sources, retrieval, elapsed, issues, pass: isPass };
    } catch (err) {
      console.error(`\n💥 异常: ${err.message}`);
      result = { ...tc, answer: '', sources: [], retrieval: null, elapsed: -1, issues: [`💥 ${err.message}`], pass: false, error: err.message };
      totalIssues++;
    }

    results.push(result);
  }

  // ── 汇总 ──
  const total = cases.length;
  console.log('\n\n' + '█'.repeat(60));
  console.log('📊 汇总报告');
  console.log('█'.repeat(60));
  console.log(`  总计: ${total}  |  通过: ${passCount}  |  Badcase: ${total - passCount}  |  问题数: ${totalIssues}`);

  const byType = {};
  for (const r of results) {
    if (!byType[r.type]) byType[r.type] = { total: 0, pass: 0 };
    byType[r.type].total++;
    if (r.pass) byType[r.type].pass++;
  }
  console.log('\n  按类别:');
  for (const [type, stats] of Object.entries(byType)) {
    const pct = stats.total > 0 ? Math.round(stats.pass / stats.total * 100) : 0;
    console.log(`    ${type}: ${stats.pass}/${stats.total} (${pct}%)`);
  }

  console.log('\n  Badcase 明细:');
  for (const r of results) {
    if (!r.pass) {
      console.log(`    ${r.id} ${r.title} — ${r.issues.join('; ')}`);
    }
  }

  // ── 保存结果 ──
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = resolve(RESULTS_DIR, `hardcase-results-${timestamp}.json`);
  writeFileSync(jsonPath, JSON.stringify({ timestamp, total, passCount, totalIssues, results }, null, 2));
  console.log(`\n💾 已保存: ${jsonPath}`);

  // 生成简短 Markdown 报告
  const mdPath = resolve(RESULTS_DIR, `hardcase-results-${timestamp}.md`);
  const mdLines = [
    `# 高难度 Badcase 测试报告`,
    `\n时间: ${new Date().toLocaleString('zh-CN')}`,
    `总计: ${total} | 通过: ${passCount} | Badcase: ${total - passCount} | 问题数: ${totalIssues}`,
    `\n## 按类别`,
  ];
  for (const [type, stats] of Object.entries(byType)) {
    const pct = stats.total > 0 ? Math.round(stats.pass / stats.total * 100) : 0;
    mdLines.push(`- ${type}: ${stats.pass}/${stats.total} (${pct}%)`);
  }
  mdLines.push('\n## Badcase');
  for (const r of results) {
    if (r.pass) continue;
    mdLines.push(`\n### ${r.id} ${r.title}`);
    mdLines.push(`- Query: ${r.query}`);
    mdLines.push(`- 耗时: ${r.elapsed}ms`);
    r.issues.forEach(i => mdLines.push(`- ${i}`));
    mdLines.push(`- 回答片段: ${(r.answer || '').substring(0, 200)}`);
  }
  mdLines.push('\n## 全量通过');
  for (const r of results) {
    if (!r.pass) continue;
    mdLines.push(`- ✅ ${r.id} ${r.title} (${r.elapsed}ms)`);
  }
  writeFileSync(mdPath, mdLines.join('\n'));
  console.log(`💾 Markdown 报告: ${mdPath}`);

  process.exit(totalIssues > 0 ? 0 : 0); // 不因 Badcase 而 exit 非零
}

main().catch(err => {
  console.error(`\n💥 脚本异常: ${err.message}`);
  process.exit(1);
});
