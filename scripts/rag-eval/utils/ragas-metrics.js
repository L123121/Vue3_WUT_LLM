/**
 * RAGAS 指标计算模块
 * 基于 LLM judge 实现 4 个核心 RAGAS 指标
 *
 * 参考: https://docs.ragas.io/en/latest/concepts/metrics/index.html
 *
 * 由于讯飞 ChatDoc 检索是黑盒，contexts 通过 fileRefer 中的 chunk 索引
 * 从文档内容中切片获取。
 */

import { llmJudge } from './api-client.js';

// ============================================================
// 1. Faithfulness（忠实度）
//    回答是否忠于检索到的上下文，hallucination 检测
// ============================================================

const FAITHFULNESS_SYSTEM_PROMPT = `你是一个忠实度评估专家。你的任务是判断给定的回答是否完全基于提供的上下文。

规则：
1. 将回答拆解为多个独立的声明（claims）
2. 对每个声明，判断它是否能从上下文中找到支撑证据
3. 给出 0-1 之间的分数：有支撑的声明数 / 总声明数

以 JSON 格式输出：
{
  "claims": ["声明1", "声明2", ...],
  "supported": [true, false, ...],
  "score": 0.8,
  "reasoning": "简要说明"
}`;

function buildFaithfulnessPrompt(contexts, answer) {
  return `## 上下文
${contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')}

## 回答
${answer}

请评估回答的忠实度。`;
}

// ============================================================
// 2. Answer Relevancy（回答相关性）
//    回答与问题的相关程度
// ============================================================

const ANSWER_RELEVANCY_SYSTEM_PROMPT = `你是一个回答相关性评估专家。你的任务是判断给定的回答是否与问题相关。

规则：
1. 理解问题的核心意图
2. 评估回答是否直接回应了问题
3. 检查回答是否包含与问题无关的信息
4. 给出 0-1 之间的分数

以 JSON 格式输出：
{
  "score": 0.9,
  "reasoning": "简要说明",
  "relevant_parts": ["回答中与问题相关的部分"],
  "irrelevant_parts": ["回答中与问题无关的部分（如有）"]
}`;

function buildAnswerRelevancyPrompt(question, answer) {
  return `## 问题
${question}

## 回答
${answer}

请评估回答与问题的相关性。`;
}

// ============================================================
// 3. Context Precision（上下文精确度）
//    检索到的上下文中有多少是相关的
// ============================================================

const CONTEXT_PRECISION_SYSTEM_PROMPT = `你是一个上下文精确度评估专家。你的任务是判断检索到的每个上下文片段是否与问题相关。

规则：
1. 理解问题的核心意图
2. 对每个上下文片段，判断它是否包含回答问题所需的信息
3. 考虑上下文片段的排名（靠前的权重更高）
4. 给出 0-1 之间的加权分数

评分公式：Precision@K = Σ(precision@k × rel(k)) / 总相关片段数
其中 precision@k = 前 k 个片段中相关片段的比例，rel(k) = 第 k 个片段是否相关

以 JSON 格式输出：
{
  "relevance": [true, false, true, ...],
  "score": 0.75,
  "reasoning": "简要说明"
}`;

function buildContextPrecisionPrompt(question, contexts) {
  return `## 问题
${question}

## 检索到的上下文（按检索排名顺序）
${contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')}

请评估每个上下文片段的相关性。`;
}

// ============================================================
// 4. Context Recall（上下文召回率）
//    标准答案中的信息有多少被检索到的上下文覆盖
// ============================================================

const CONTEXT_RECALL_SYSTEM_PROMPT = `你是一个上下文召回率评估专家。你的任务是判断标准答案中的关键信息是否被检索到的上下文覆盖。

规则：
1. 将标准答案拆解为多个关键信息点（claims）
2. 对每个信息点，检查它是否在检索到的上下文中有所体现
3. 给出 0-1 之间的分数：被覆盖的信息点数 / 总信息点数

以 JSON 格式输出：
{
  "claims": ["信息点1", "信息点2", ...],
  "covered": [true, false, ...],
  "score": 0.8,
  "reasoning": "简要说明"
}`;

function buildContextRecallPrompt(groundTruth, contexts) {
  return `## 标准答案
${groundTruth}

## 检索到的上下文
${contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')}

请评估上下文对标准答案的覆盖率。`;
}

// ============================================================
// LLM 调用 + 分数解析
// ============================================================

/**
 * 调用 LLM judge 并解析分数
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<{score: number, detail: Object}>}
 */
async function callJudge(systemPrompt, userPrompt) {
  const raw = await llmJudge(systemPrompt, userPrompt, { temperature: 0, maxTokens: 2000 });

  // 尝试从 LLM 输出中提取 JSON
  let parsed;
  try {
    // 尝试直接解析
    parsed = JSON.parse(raw);
  } catch {
    // 尝试从 markdown code block 中提取
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[1].trim());
      } catch {}
    }
    // 尝试从花括号中提取
    if (!parsed) {
      const braceMatch = raw.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        try {
          parsed = JSON.parse(braceMatch[0]);
        } catch {}
      }
    }
  }

  if (!parsed || typeof parsed.score !== 'number') {
    console.warn('  [RAGAS] LLM 输出解析失败，原始输出:', raw.substring(0, 200));
    return { score: 0, detail: { error: '解析失败', raw: raw.substring(0, 500) } };
  }

  // 归一化分数到 [0, 1]
  let score = parsed.score;
  if (score > 1) score = score / 100; // 处理 LLM 返回百分比的情况
  score = Math.max(0, Math.min(1, score));

  return { score, detail: parsed };
}

// ============================================================
// 导出的指标计算函数
// ============================================================

/**
 * 计算 Faithfulness（忠实度）
 * @param {string[]} contexts - 检索到的上下文片段
 * @param {string} answer - 生成的回答
 * @returns {Promise<{score: number, detail: Object}>}
 */
export async function computeFaithfulness(contexts, answer) {
  const prompt = buildFaithfulnessPrompt(contexts, answer);
  return callJudge(FAITHFULNESS_SYSTEM_PROMPT, prompt);
}

/**
 * 计算 Answer Relevancy（回答相关性）
 * @param {string} question - 用户问题
 * @param {string} answer - 生成的回答
 * @returns {Promise<{score: number, detail: Object}>}
 */
export async function computeAnswerRelevancy(question, answer) {
  const prompt = buildAnswerRelevancyPrompt(question, answer);
  return callJudge(ANSWER_RELEVANCY_SYSTEM_PROMPT, prompt);
}

/**
 * 计算 Context Precision（上下文精确度）
 * @param {string} question - 用户问题
 * @param {string[]} contexts - 检索到的上下文片段（按排名顺序）
 * @returns {Promise<{score: number, detail: Object}>}
 */
export async function computeContextPrecision(question, contexts) {
  const prompt = buildContextPrecisionPrompt(question, contexts);
  return callJudge(CONTEXT_PRECISION_SYSTEM_PROMPT, prompt);
}

/**
 * 计算 Context Recall（上下文召回率）
 * @param {string} groundTruth - 标准答案
 * @param {string[]} contexts - 检索到的上下文片段
 * @returns {Promise<{score: number, detail: Object}>}
 */
export async function computeContextRecall(groundTruth, contexts) {
  const prompt = buildContextRecallPrompt(groundTruth, contexts);
  return callJudge(CONTEXT_RECALL_SYSTEM_PROMPT, prompt);
}

/**
 * 计算所有 RAGAS 指标
 * @param {Object} params
 * @param {string} params.question
 * @param {string} params.answer
 * @param {string[]} params.contexts
 * @param {string} params.groundTruth
 * @returns {Promise<Object>}
 */
export async function computeAllMetrics({ question, answer, contexts, groundTruth }) {
  const [faithfulness, answerRelevancy, contextPrecision, contextRecall] = await Promise.all([
    computeFaithfulness(contexts, answer),
    computeAnswerRelevancy(question, answer),
    computeContextPrecision(question, contexts),
    computeContextRecall(groundTruth, contexts)
  ]);

  return {
    faithfulness,
    answer_relevancy: answerRelevancy,
    context_precision: contextPrecision,
    context_recall: contextRecall,
    // 综合分（四个指标的均值）
    overall: (
      faithfulness.score +
      answerRelevancy.score +
      contextPrecision.score +
      contextRecall.score
    ) / 4
  };
}
