/**
 * 评测报告生成器
 * 生成 JSON 和 Markdown 格式的综合报告
 */

import { writeFileSync } from 'fs';

export function generateMarkdownReport(retrievalResult, ragasResult) {
  const now = new Date().toLocaleString('zh-CN');
  let md = '';

  md += `# RAG 评测报告\n\n`;
  md += `> 生成时间: ${now}\n\n`;
  md += `---\n\n`;

  if (retrievalResult) {
    const s = retrievalResult.summary;
    md += `## 1. 检索质量评测\n\n`;
    md += `| 指标 | 值 |\n|------|------|\n`;
    md += `| 有效样本 | ${s.evaluated} / ${s.total} |\n`;
    md += `| Recall | ${s.overall.recall} |\n`;
    md += `| Precision | ${s.overall.precision} |\n`;
    md += `| MRR | ${s.overall.mrr} |\n`;
    md += `| Hit Rate | ${s.overall.hitRate} |\n`;

    for (const [key, value] of Object.entries(s.overall)) {
      if (key.startsWith('recall@') || key.startsWith('ndcg@')) {
        md += `| ${key.toUpperCase()} | ${value} |\n`;
      }
    }

    md += `\n### 按类别\n\n`;
    md += `| 类别 | Recall | Precision | MRR | nDCG@5 | 样本数 |\n|------|--------|-----------|-----|--------|--------|\n`;
    for (const [category, stats] of Object.entries(s.byCategory || {})) {
      md += `| ${category} | ${stats.recall} | ${stats.precision} | ${stats.mrr} | ${stats.ndcg5 || '-'} | ${stats.count} |\n`;
    }

    md += `\n### 按难度\n\n`;
    md += `| 难度 | Recall | Hit Rate | MRR | nDCG@5 | 样本数 |\n|------|--------|----------|-----|--------|--------|\n`;
    for (const [difficulty, stats] of Object.entries(s.byDifficulty || {})) {
      md += `| ${difficulty} | ${stats.recall} | ${stats.hitRate} | ${stats.mrr || '-'} | ${stats.ndcg5 || '-'} | ${stats.count} |\n`;
    }

    if (s.byBadCase) {
      md += `\n### Bad Case 分类\n\n`;
      md += `| 类型 | 数量 |\n|------|------|\n`;
      for (const [type, count] of Object.entries(s.byBadCase)) {
        md += `| ${type} | ${count} |\n`;
      }
    }

    const badCases = retrievalResult.badCases || retrievalResult.results.filter(result => result.badCase && result.badCase.type !== 'pass');
    if (badCases.length > 0) {
      md += `\n### Bad Case 示例\n\n`;
      md += `| ID | 类型 | 原因 | 问题 |\n|----|------|------|------|\n`;
      for (const item of badCases.slice(0, 10)) {
        md += `| ${item.id} | ${item.badCase?.type || 'unknown'} | ${item.badCase?.reason || '-'} | ${item.question.substring(0, 40)}... |\n`;
      }
      if (badCases.length > 10) md += `\n> 共 ${badCases.length} 条 Bad Case，仅显示前 10 条\n`;
    }

    md += `\n---\n\n`;
  }

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
    for (const [category, stats] of Object.entries(s.byCategory || {})) {
      md += `| ${category} | ${stats.avg.faithfulness} | ${stats.avg.answer_relevancy} | ${stats.avg.context_precision} | ${stats.avg.context_recall} | ${stats.count} |\n`;
    }

    md += `\n### 按难度\n\n`;
    md += `| 难度 | Overall | Faithfulness | Ans.Rel. | 样本数 |\n|------|---------|-------------|----------|--------|\n`;
    for (const [difficulty, stats] of Object.entries(s.byDifficulty || {})) {
      md += `| ${difficulty} | ${stats.avg.overall} | ${stats.avg.faithfulness} | ${stats.avg.answer_relevancy} | ${stats.count} |\n`;
    }

    const lowScores = ragasResult.results
      .filter(result => result.metrics && result.metrics.overall < 0.5)
      .sort((a, b) => a.metrics.overall - b.metrics.overall);

    if (lowScores.length > 0) {
      md += `\n### 低分案例（Overall < 50%）\n\n`;
      md += `| ID | 问题 | Overall | Faith. | Ans.Rel. |\n|----|------|---------|--------|----------|\n`;
      for (const item of lowScores.slice(0, 10)) {
        md += `| ${item.id} | ${item.question.substring(0, 30)}... | ${(item.metrics.overall * 100).toFixed(0)}% | ${(item.metrics.faithfulness * 100).toFixed(0)}% | ${(item.metrics.answer_relevancy * 100).toFixed(0)}% |\n`;
      }
    }

    md += `\n---\n\n`;
  }

  md += `## 3. 综合分析\n\n`;

  if (retrievalResult && ragasResult) {
    const rSum = retrievalResult.summary;
    const aSum = ragasResult.summary;
    const recall = parseFloat(rSum.overall.recall) / 100;
    const faithfulness = parseFloat(aSum.overall.faithfulness) / 100;

    md += `### 关键发现\n\n`;
    if (recall < 0.5) {
      md += `- ⚠️ **检索召回率偏低** (${rSum.overall.recall})：建议检查文档覆盖、切片策略、TopK 和混合召回权重\n`;
    }
    if (faithfulness < 0.7) {
      md += `- ⚠️ **忠实度偏低** (${aSum.overall.faithfulness})：建议加强 prompt 约束、引用校验和拒答阈值\n`;
    }
    if ((rSum.badCaseCount || 0) > 0) {
      md += `- ⚠️ **存在 Bad Case** (${rSum.badCaseCount} 条)：优先按 recall_miss、ranking_error、generation_refusal 分类处理\n`;
    }
    if (recall >= 0.7 && faithfulness >= 0.8 && (rSum.badCaseCount || 0) === 0) {
      md += `- ✅ 检索和生成质量均表现良好\n`;
    }

    md += `\n### 改进建议\n\n`;
    md += `1. **召回优化**：对比纯向量、BM25、混合召回和 RRF 融合效果\n`;
    md += `2. **排序优化**：关注 MRR 与 nDCG@K，针对 ranking_error 调整 rerank 策略\n`;
    md += `3. **生成优化**：对 generation_refusal 和幻觉样例单独复盘 prompt 与阈值\n`;
    md += `4. **持续评测**：每次修改 chunk、TopK、权重、模型后固定跑 Golden Set\n`;
  } else {
    md += `请同时运行检索评测和生成质量评测，形成完整 RAG 闭环。\n`;
  }

  md += `\n---\n\n`;
  md += `## 4. 人工评测说明\n\n`;
  md += `自动化评测指标存在局限性，建议结合人工评测：\n\n`;
  md += `1. 访问 \`http://localhost:5173/eval\` 打开人工打分页面\n`;
  md += `2. 对每个回答从 **准确性**、**完整性**、**相关性**、**引用正确性** 四个维度打分\n`;
  md += `3. 对 Bad Case 填写失败原因和修复动作，形成优化记录\n`;
  md += `4. 将人工评测结果作为上线前验收的最终参考\n\n`;

  return md;
}

export function saveReport(retrievalResult, ragasResult, outputDir) {
  const mdReport = generateMarkdownReport(retrievalResult, ragasResult);
  const mdPath = `${outputDir}/eval-report.md`;
  writeFileSync(mdPath, mdReport);

  const jsonReport = {
    timestamp: new Date().toISOString(),
    retrieval: retrievalResult?.summary || null,
    ragas: ragasResult?.summary || null,
    retrievalDetails: retrievalResult?.results || [],
    badCases: retrievalResult?.badCases || [],
    ragasDetails: ragasResult?.results || []
  };
  const jsonPath = `${outputDir}/eval-report.json`;
  writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));

  return { mdPath, jsonPath };
}
