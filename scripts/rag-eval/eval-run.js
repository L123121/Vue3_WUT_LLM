/**
 * RAG 评测主入口
 * 一键运行检索质量评测 + RAGAS 生成质量评测 + 生成综合报告
 *
 * 用法:
 *   node eval-run.js              # 运行全部评测
 *   node eval-run.js --retrieval  # 只运行检索评测
 *   node eval-run.js --ragas      # 只运行 RAGAS 评测
 *   node eval-run.js --sample 5   # 只评测前 5 条（调试用）
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runRetrievalEval } from './eval-retrieval.js';
import { runRagasEval } from './eval-ragas.js';
import { saveReport } from './utils/report-generator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, 'results');

async function main() {
  const args = process.argv.slice(2);
  const onlyRetrieval = args.includes('--retrieval');
  const onlyRagas = args.includes('--ragas');
  const sampleIdx = args.indexOf('--sample');
  const sampleSize = sampleIdx >= 0 ? parseInt(args[sampleIdx + 1]) || 0 : 0;

  const runAll = !onlyRetrieval && !onlyRagas;

  console.log('╔══════════════════════════════════════╗');
  console.log('║       RAG 评测系统 v1.0              ║');
  console.log('╚══════════════════════════════════════╝');

  if (sampleSize > 0) {
    console.log(`\n⚠️  采样模式: 仅评测前 ${sampleSize} 条`);
  }

  let retrievalResult = null;
  let ragasResult = null;

  // 1. 检索质量评测
  if (runAll || onlyRetrieval) {
    try {
      retrievalResult = await runRetrievalEval({ sampleSize });
    } catch (err) {
      console.error('\n❌ 检索评测失败:', err.message);
    }
  }

  // 2. RAGAS 生成质量评测
  if (runAll || onlyRagas) {
    try {
      ragasResult = await runRagasEval({ sampleSize });
    } catch (err) {
      console.error('\n❌ RAGAS 评测失败:', err.message);
    }
  }

  // 3. 生成综合报告
  if (retrievalResult || ragasResult) {
    const { mdPath, jsonPath } = saveReport(retrievalResult, ragasResult, RESULTS_DIR);
    console.log('\n\n📄 综合报告已生成:');
    console.log(`   Markdown: ${mdPath}`);
    console.log(`   JSON:     ${jsonPath}`);
  }

  // 4. 提示人工评测
  console.log('\n\n💡 下一步:');
  console.log('   1. 查看 results/eval-report.md 了解评测结果');
  console.log('   2. 启动前端后访问 http://localhost:5173/eval 进行人工打分');
  console.log('   3. 对比自动评测与人工评测结果，优化 RAG 系统\n');

  console.log('✅ 评测完成');
}

main().catch(err => {
  console.error('\n💥 评测异常:', err);
  process.exit(1);
});
