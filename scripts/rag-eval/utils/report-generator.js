/**
 * 评测报告生成器
 * 生成 JSON 和 Markdown 格式的综合报告
 */

import { writeFileSync } from 'fs';

/**
 * 生成 Markdown 格式的评测报告
 * @param {Object} retrievalResult - 检索评测结果
 * @param {Object} ragasResult - RAGAS 评测结果
 * @returns {string}
 */
export function generateMarkdownReport(retrievalResult, ragasResult) {
  const now = new Date().toLocaleString('zh-CN');
  let md = '';

  md += `# RAG 评测报告\n\n`;
  md += `> 生成时间: ${now}\n\n`;
  md += `---\n\n`;

  // ===== 检索质量 =====
  if (retrievalResult) {
    const s = retrievalResult.summary;
    md += `## 1. 检索质量评测\n\n`;
    md += `| 指标 | 值 |\n|------|------|\n`;
    md += `| 有效样本 | ${s.evaluated} / ${s.total} |\n`;
    md += `| Recall | ${s.overall.recall} |\n`;
    md += `| Precision | ${s.overall.precision} |\n`;
    md += `| MRR | ${s.overall.mrr} |\n`;
    md += `| Hit Rate | ${s.overall.hitRate} |\n`;

    // Recall@K
    for (const [k, v] of Object.entries(s.overall)) {
      if (k.startsWith('recall@')) {
        md += `| ${k.toUpperCase()} | ${v} |\n`;
      }
    }

    md += `\n### 按类别\n\n`;
    md += `| 类别 | Recall | Precision | MRR | 样本数 |\n|------|--------|-----------|-----|--------|\n`;
    for (const [cat, stats] of Object.entries(s.byCategory)) {
      md += `| ${cat} | ${stats.recall} | ${stats.precision} | ${stats.mrr} | ${stats.count} |\n`;
    }

    md += `\n### 按难度\n\n`;
    md += `| 难度 | Recall | Hit Rate | 样本数 |\n|------|--------|----------|--------|\n`;
    for (const [diff, stats] of Object.entries(s.byDifficulty)) {
      md += `| ${diff} | ${stats.recall} | ${stats.hitRate} | ${stats.count} |\n`;
    }

    // 失败案例
    const failures = retrievalResult.results.filter(r => r.metrics && r.metrics.hitRate === 0);
    if (failures.length > 0) {
      md += `\n### 未命中案例\n\n`;
      md += `| ID | 问题 | 类别 | 难度 |\n|----|------|------|------|\n`;
      for (const f of failures.slice(0, 10)) {
        md += `| ${f.id} | ${f.question.substring(0, 40)}... | ${f.category} | ${f.difficulty} |\n`;
      }
      if (failures.length > 10) md += `\n> 共 ${failures.length} 条未命中，仅显示前 10 条\n`;
    }

    md += `\n---\n\n`;
  }

  // ===== RAGAS 生成质量 =====
  if (ragasResult) {
    const s = ragasResult.summary;
    md += `## 2. RAGAS 生成质量评测\n\n`;
    md += `| 指标 | 值 | 说明 |\n|------|------|------|\n`;
    md += `| 有效样本 | ${s.evaluated} / ${s.total} | |\n`;
    md += `| Faithfulness | ${s.overall.faithfulness} | 回答是否忠于上下文 |\n`;
    md += `| Answer Relevancy | ${s.overall.answer_relevancy} | 回答与问题的相关程度 |\n`;
    md += `| Context Precision | ${s.overall.context_precision} | 检索上下文的精确度 |\n`;
    md += `| Context Recall | ${s.overall.context_recall} | 上下文对标准答案的覆盖率 |\n`;
    md += `| Overall | ${s.overall.overall} | 四项指标均值 |\n`;

    md += `\n### 按类别\n\n`;
    md += `| 类别 | Faith. | Ans.Rel. | Ctx.Prec. | Ctx.Rec. | 样本数 |\n|------|--------|----------|-----------|----------|--------|\n`;
    for (const [cat, stats] of Object.entries(s.byCategory)) {
      md += `| ${cat} | ${stats.avg.faithfulness} | ${stats.avg.answer_relevancy} | ${stats.avg.context_precision} | ${stats.avg.context_recall} | ${stats.count} |\n`;
    }

    md += `\n### 按难度\n\n`;
    md += `| 难度 | Overall | Faithfulness | Ans.Rel. | 样本数 |\n|------|---------|-------------|----------|--------|\n`;
    for (const [diff, stats] of Object.entries(s.byDifficulty)) {
      md += `| ${diff} | ${stats.avg.overall} | ${stats.avg.faithfulness} | ${stats.avg.answer_relevancy} | ${stats.count} |\n`;
    }

    // 低分案例
    const lowScores = ragasResult.results
      .filter(r => r.metrics && r.metrics.overall < 0.5)
      .sort((a, b) => a.metrics.overall - b.metrics.overall);

    if (lowScores.length > 0) {
      md += `\n### 低分案例（Overall < 50%）\n\n`;
      md += `| ID | 问题 | Overall | Faith. | Ans.Rel. |\n|----|------|---------|--------|----------|\n`;
      for (const f of lowScores.slice(0, 10)) {
        md += `| ${f.id} | ${f.question.substring(0, 30)}... | ${(f.metrics.overall * 100).toFixed(0)}% | ${(f.metrics.faithfulness * 100).toFixed(0)}% | ${(f.metrics.answer_relevancy * 100).toFixed(0)}% |\n`;
      }
    }

    md += `\n---\n\n`;
  }

  // ===== 综合分析 =====
  md += `## 3. 综合分析\n\n`;

  if (retrievalResult && ragasResult) {
    const rSum = retrievalResult.summary;
    const aSum = ragasResult.summary;

    md += `### 关键发现\n\n`;

    // 检索 vs 生成对比
    const recall = parseFloat(rSum.overall.recall) / 100;
    const faithfulness = parseFloat(aSum.overall.faithfulness) / 100;

    if (recall < 0.5) {
      md += `- ⚠️ **检索召回率偏低** (${rSum.overall.recall})：大量相关文档未被检索到，建议优化文档上传策略或增加知识库覆盖\n`;
    }
    if (faithfulness < 0.7) {
      md += `- ⚠️ **忠实度偏低** (${aSum.overall.faithfulness})：AI 回答存在幻觉风险，建议降低 temperature 或加强 prompt 约束\n`;
    }
    if (recall >= 0.7 && faithfulness >= 0.8) {
      md += `- ✅ 检索和生成质量均表现良好\n`;
    }

    md += `\n### 改进建议\n\n`;
    md += `1. **检索优化**: 增加文档分块质量，优化 chunk 大小和 overlap\n`;
    md += `2. **生成优化**: 调整 system prompt，约束 AI 只基于检索内容回答\n`;
    md += `3. **知识库扩充**: 覆盖更多校园信息维度，减少"无答案"情况\n`;
    md += `4. **持续评测**: 定期运行评测，跟踪指标变化趋势\n`;
  }

  md += `\n---\n\n`;
  md += `## 4. 人工评测说明\n\n`;
  md += `自动化评测指标（RAGAS）存在局限性，建议结合人工评测：\n\n`;
  md += `1. 访问 \`http://localhost:5173/eval\` 打开人工打分页面\n`;
  md += `2. 对每个回答从 **准确性**、**完整性**、**相关性** 三个维度打 1-5 分\n`;
  md += `3. 对比人工分数与 RAGAS 自动分数，分析差异原因\n`;
  md += `4. 将人工评测结果作为 RAG 系统优化的最终参考\n\n`;

  return md;
}

/**
 * 保存综合评测报告
 * @param {Object} retrievalResult
 * @param {Object} ragasResult
 * @param {string} outputDir
 */
export function saveReport(retrievalResult, ragasResult, outputDir) {
  // Markdown 报告
  const mdReport = generateMarkdownReport(retrievalResult, ragasResult);
  const mdPath = `${outputDir}/eval-report.md`;
  writeFileSync(mdPath, mdReport);

  // JSON 综合结果
  const jsonReport = {
    timestamp: new Date().toISOString(),
    retrieval: retrievalResult?.summary || null,
    ragas: ragasResult?.summary || null,
    retrievalDetails: retrievalResult?.results || [],
    ragasDetails: ragasResult?.results || []
  };
  const jsonPath = `${outputDir}/eval-report.json`;
  writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));

  return { mdPath, jsonPath };
}
