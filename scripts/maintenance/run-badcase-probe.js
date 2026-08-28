/**
 * 六类 Bad Case 根因探测测试
 * 逐题发送 → 记录回答 + 自动归类 → 对比预期标签
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
// JWT 密钥：环境变量优先，其次读 backend/.env（与后端服务同一密钥）
const SECRET_ENV = path.resolve(__dirname, '../../backend/.env');
const JWT_SECRET =
  process.env.JWT_SECRET ||
  (fs.existsSync(SECRET_ENV) && fs.readFileSync(SECRET_ENV, 'utf8').match(/^JWT_SECRET=(.+)$/m)?.[1].trim());
if (!JWT_SECRET) {
  console.error('未找到 JWT_SECRET：请设置环境变量 JWT_SECRET，或在 backend/.env 中配置');
  process.exit(1);
}

function makeJWT(p,s) {
  const h=Buffer.from(JSON.stringify({alg:'HS256',type:'JWT'})).toString('base64url');
  const b=Buffer.from(JSON.stringify(p)).toString('base64url');
  const sig=crypto.createHmac('sha256',s).update(h+'.'+b).digest('base64url');
  return h+'.'+b+'.'+sig;
}
const cookie = 'auth_token=' + makeJWT({userId:'x',exp:Math.floor(Date.now()/1000)+86400}, JWT_SECRET);

const REFUSAL_PATTERNS = /没有检索到|知识库资料不足|知识库中没有|无法回答|未提供|暂无.*信息|资料中未提及/;

// === 测试用例 ===
const TEST_CASES = [
  // RM - 检索遗漏
  {id:'RM-1', q:'武汉理工大学的英文简称是什么？它的校庆日是哪一天？',              expected:'recall_miss',   category:'学校概况'},
  {id:'RM-2', q:'武汉理工大学是哪一年进入"211工程"的？又是哪一年入选"双一流"的？', expected:'recall_miss',   category:'学校概况'},

  // RN - 排序噪音
  {id:'RN-1', q:'武汉理工大学有几个国家级重点实验室？分别叫什么名字？',              expected:'ranking_error', category:'学校概况'},
  {id:'RN-3', q:'武汉理工大学有哪些知名校友？',                                      expected:'ranking_error', category:'学校概况'},

  // CT - 上下文截断
  {id:'CT-1', q:'武汉理工大学三个校区分别位于什么地址？各自的占地面积是多少？',      expected:'noisy_context', category:'学校概况'},
  {id:'CT-2', q:'武汉理工大学图书馆的阅览座位有多少个？24小时自习室是否开放？',      expected:'noisy_context', category:'学校概况'},

  // HA - 生成幻觉
  {id:'HA-1', q:'武汉理工大学的学生男女比例是多少？',                                expected:'hallucination', category:'学校概况'},
  {id:'HA-2', q:'武汉理工大学的食堂饭菜口味如何？有哪些特色菜品？',                  expected:'hallucination', category:'学校概况'},

  // IA - 答非所问
  {id:'IA-1', q:'武汉理工大学有哪些学院设有"国家级一流本科专业"？',                   expected:'irrelevant',    category:'学校概况'},

  // RF - 拒答失效
  {id:'RF-1', q:'武汉理工大学2025年在湖北省的最低录取分数线是多少？',                 expected:'generation_refusal', category:'学校概况'},
  {id:'RF-2', q:'武汉理工大学校长是谁？',                                             expected:'generation_refusal', category:'学校概况'},
];

function classify(answer, sources) {
  const refused = REFUSAL_PATTERNS.test(answer || '');
  if (refused && sources?.length > 0) return 'generation_refusal';
  if (refused && !sources?.length) return 'no_retrieval';
  if (!sources?.length) return 'no_retrieval';
  return 'pass';
}

function detect_hallucination(answer, context) {
  // 如果回答包含详细数字/具体描述但上下文为空或极短 → 很可能幻觉
  if (!context || context.length < 50) {
    const hasDetail = /[0-9]{2,}|具体|分为|包括|例如/.test(answer || '');
    if (hasDetail && !REFUSAL_PATTERNS.test(answer || '')) return true;
  }
  return false;
}

async function main() {
  console.log('='.repeat(100));
  console.log('  RAG 六类 Bad Case 根因探测测试');
  console.log('='.repeat(100));
  console.log('');

  const results = [];

  for (const tc of TEST_CASES) {
    process.stdout.write(`${tc.id} [预期:${tc.expected}] ${tc.q.substring(0,40)}... `);

    try {
      const r = await fetch('http://localhost:3000/api/rag/chat', {
        method:'POST',
        headers:{'Content-Type':'application/json', Cookie:cookie},
        body: JSON.stringify({message:tc.q, history:[], category:tc.category})
      });
      const body = await r.json();
      const d = body.data || body;
      const answer = d.reply || d.answer || '';
      const context = d.context || '';
      const sources = d.sources || [];

      const actual = classify(answer, sources);
      const isHallu = detect_hallucination(answer, context);
      const match = actual === tc.expected ? '✅' : '⚠️';

      const summary = answer.substring(0, 120).replace(/\n/g, ' ');

      results.push({id:tc.id, expected:tc.expected, actual, isHallu, match, summary, sourceCount:sources.length, contextLen:context.length, answer});
      console.log(` ${match} actual=${actual}${isHallu?' +hallucination':''} | ${summary}`);
    } catch (err) {
      console.log(` ❌ error: ${err.message}`);
      results.push({id:tc.id, expected:tc.expected, actual:'api_error', isHallu:false, match:false, summary:err.message, sourceCount:0, contextLen:0, answer:''});
    }
  }

  // ===== 汇总 =====
  console.log('\n' + '='.repeat(100));
  console.log('  汇总');
  console.log('='.repeat(100));
  console.log('');

  const byExpected = {};
  for (const r of results) {
    if (!byExpected[r.expected]) byExpected[r.expected] = {total:0, match:0, items:[]};
    byExpected[r.expected].total++;
    if (r.match) byExpected[r.expected].match++;
    byExpected[r.expected].items.push(r);
  }

  for (const [type, stats] of Object.entries(byExpected)) {
    const pct = ((stats.match/stats.total)*100).toFixed(0);
    const bar = '█'.repeat(stats.match) + '░'.repeat(stats.total-stats.match);
    console.log(`  ${type.padEnd(20)} ${stats.match}/${stats.total} ${bar} ${pct}%`);

    for (const r of stats.items) {
      const marker = r.match ? '✅' : '⚠️';
      const hallu = r.isHallu ? ' 🔮幻觉' : '';
      console.log(`    ${marker} ${r.id}: expected=${r.expected}, actual=${r.actual}${hallu}, ctx=${r.contextLen}B, src=${r.sourceCount}`);
    }
    console.log('');
  }

  // 重点分析：幻觉 & 拒答失效
  console.log('── 幻觉/拒答专项 ──');
  for (const r of results) {
    if (r.expected === 'hallucination' || r.expected === 'generation_refusal') {
      const verdict = r.isHallu ? '🔮 疑似幻觉' : (REFUSAL_PATTERNS.test(r.answer||'') ? '✅ 正确拒答' : '⚠️ 未拒答');
      const shortened = r.answer.length > 200 ? r.answer.substring(0,200)+'...' : r.answer;
      console.log(`  ${r.id} ${verdict}: ${shortened}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
