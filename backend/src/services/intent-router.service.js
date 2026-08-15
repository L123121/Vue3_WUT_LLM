"use strict";

const { AiService } = require("./ai.service");

/**
 * IntentRouter — 意图识别与自动路由层（V2.0）
 *
 * 面试官反馈①：RAG 不应让用户手动开关，应加一层意图识别自动路由。
 * 本层对应架构图中的 "意图识别层 (NLU)" + "任务路由"，让用户无感知：
 *   用户只负责提问，系统自动决定走哪条链路。
 *
 * 路由设计（裁剪存档版 intent-router，路由表收敛为三类）：
 *   - chat   普通闲聊（问候/感谢/告别）→ 纯 LLM，不触发检索（快、省）
 *   - agent  多步/复合任务（规划、综合对比分析）→ 工具调度（见 P1 工具层）
 *   - rag    校内知识问答（默认兜底）→ RAG 检索管道
 *
 * 关键原则（来自存档回退教训）：
 *   1. fastRoute 只保留"零误判"的高置信关键词规则，不做低置信正则硬路由
 *      （低置信正则误路由率高，会架空 LLM 决策，也是当初 Agent 回退的原因之一）。
 *   2. 兜底默认走 rag 而非 chat——校园问答主场景是知识库；
 *      纯闲聊被 fastRoute 截走，其余问题走 RAG 检索管道，
 *      管道内部已有"无可靠来源→降级纯 LLM"的兜底，不会误伤闲聊。
 *   3. LLM 分类默认关闭（INTENT_CLASSIFY_ENABLED=true 才启用），
 *      避免每条消息多一次 LLM 调用拖慢首包延迟（简历口径 SSE 首包 ~130ms 不回退）；
 *      fastRoute 零成本路由常开。
 */

// 意图类型定义
const INTENT_TYPES = {
  KNOWLEDGE_QUERY: "knowledge_query", // 校内知识问答 → rag
  GENERAL_CHAT: "general_chat",       // 普通闲聊 → chat
  COMPLEX_TASK: "complex_task",       // 多步/复合任务 → agent
  CALCULATION_TASK: "calculation_task", // 明确数学计算 → agent/calculate
};

// 意图路由表：意图类型 → { route, description }
const ROUTE_MAP = {
  [INTENT_TYPES.KNOWLEDGE_QUERY]: { route: "rag", description: "知识库检索" },
  [INTENT_TYPES.GENERAL_CHAT]: { route: "chat", description: "普通对话" },
  [INTENT_TYPES.COMPLEX_TASK]: { route: "agent", description: "多步任务" },
  [INTENT_TYPES.CALCULATION_TASK]: { route: "agent", description: "数学计算" },
};

/**
 * 轻量级意图分类 prompt（LLM 兜底，默认关闭）
 * 只做分类，不做推理 — 快、省 token
 */
const CLASSIFICATION_PROMPT = `你是一个意图分类器。请分析用户的消息，返回 JSON 格式的分类结果。

可能的意图类型：
- knowledge_query: 校园知识问答（如"学校食堂几点关门"、"图书馆怎么借书"、"什么是数据结构"、"奖学金怎么申请"、"软件工程面试题"）——需要检索校内知识库
- general_chat: 普通对话/闲聊（如"你好"、"谢谢"、"今天天气怎么样"、"帮我写首诗"）——不需要检索知识库
- complex_task: 多步/复合任务（如"帮我制定一个期末复习计划"、"综合对比两个方案"、"规划考研时间线"）——需要多步规划与多个信息来源
- calculation_task: 明确数学计算（如"128 乘以 46"、"sqrt(144)"、"23 的 3 次方"）——需要调用计算工具

规则：
1. 只返回 JSON，不要其他内容
2. intent 字段必须取上述值之一
3. confidence 字段表示置信度（0-1）
4. 提取相关的参数到 params 字段

用户消息：{message}

返回格式：
{
  "intent": "意图类型",
  "confidence": 0.95,
  "params": {},
  "reason": "简短分类理由"
}`;

class IntentRouter {
  constructor(aiService = null) {
    this.aiService = aiService || new AiService();
  }

  /**
   * 快速路由：只做零误判的关键词匹配，不调用 LLM（~0ms）
   *
   * 设计原则：
   *   fastRoute 只保留"高置信、几乎不会误判"的规则——问候/感谢/告别、
   *   明确的多步任务。其余所有模糊意图（知识问答、校园生活、就业考研…）
   *   一律返回 null，走兜底路由（默认 rag）。
   *
   *   理由：校园问答 80%+ 是单跳知识查询，RAG 管道内部已有降级兜底；
   *   低置信正则硬路由只会增加误判面，无收益。
   *
   * @param {string} message - 用户消息
   * @returns {{intent, confidence, params, route, tool, reason}|null}
   */
  fastRoute(message) {
    const lower = String(message || "").toLowerCase().trim();

    // 问候/感谢/告别 —— 零误判，走纯 LLM 聊天（不触发检索）
    if (/^(你好|您好|嗨|哈喽|hello|hi|hey|在吗|早上好|中午好|下午好|晚上好|晚安|谢谢|感谢|多谢|再见|拜拜|bye|goodbye|辛苦了|好的|好的吧)[!！.。~～]?$/i.test(lower)) {
      return {
        intent: INTENT_TYPES.GENERAL_CHAT,
        confidence: 0.95,
        params: {},
        route: "chat",
        tool: null,
        reason: "关键词匹配：问候/感谢/告别",
      };
    }

    // 明确的多步/复合任务 —— 动词明确，置信高，走工具调度
    if (/(规划|制定.*计划|学习计划|复习计划|安排.*计划|时间线|综合.*分析|全面.*分析|权衡|利弊|对比.*(方案|计划)|哪个更适合|帮我计划|分步|一步一步)/.test(lower)) {
      return {
        intent: INTENT_TYPES.COMPLEX_TASK,
        confidence: 0.75,
        params: {},
        route: "agent",
        tool: null,
        reason: "关键词匹配：多步/复合任务",
      };
    }

    const hasNumericExpression = /\d|sqrt\s*\(|(?:sin|cos|tan|log|abs)\s*\(|\bpi\b/i.test(lower);
    const hasCalculationCue = /(算一下|计算|求值|等于多少|是多少|次方|平方|立方|平方根|开方|[+\-*/^×÷])/i.test(lower);
    if (hasNumericExpression && hasCalculationCue) {
      return {
        intent: INTENT_TYPES.CALCULATION_TASK,
        confidence: 0.9,
        params: {},
        route: "agent",
        tool: "calculate",
        reason: "能力匹配：数学计算工具",
      };
    }

    // 其余所有意图（知识问答、校园生活、政策咨询…）→ 不做硬路由，
    // 交给兜底（默认 rag，RAG 管道内部自行降级）
    return null;
  }

  /**
   * LLM 分类兜底（默认由配置开关控制，INTENT_CLASSIFY_ENABLED=true 才启用）
   * 15s 超时 + 失败/无法解析 JSON → 兜底路由
   */
  async classify(message) {
    try {
      const prompt = CLASSIFICATION_PROMPT.replace("{message}", String(message || ""));
      const response = await Promise.race([
        this.aiService.getCompletion(prompt, [], { timeout: 15000, retries: 0 }),
        new Promise((resolve) =>
          setTimeout(() => resolve({ content: "", _timeout: true }), 15000)
        ),
      ]);
      if (response._timeout) {
        console.warn("[IntentRouter] LLM 分类超时(15s)，走兜底路由");
        return this._fallbackRoute(message);
      }

      const content = String(response.content || "").trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn("[IntentRouter] 无法从 LLM 响应中提取 JSON:", content);
        return this._fallbackRoute(message);
      }

      const result = JSON.parse(jsonMatch[0]);
      const intent = result.intent || INTENT_TYPES.KNOWLEDGE_QUERY;
      const routeInfo = ROUTE_MAP[intent] || ROUTE_MAP[INTENT_TYPES.KNOWLEDGE_QUERY];

      return {
        intent,
        confidence: result.confidence || 0.5,
        params: result.params || {},
        reason: result.reason || "",
        route: routeInfo.route,
        tool: null,
      };
    } catch (err) {
      console.error("[IntentRouter] 意图分类失败:", err.message);
      return this._fallbackRoute(message);
    }
  }

  /**
   * 完整路由：先零成本 fastRoute，未命中且启用 LLM 分类时再调 LLM，否则兜底
   * @param {string} message - 用户消息
   * @returns {Promise<{intent, confidence, params, route, tool, reason}>}
   */
  async route(message) {
    const quickRoute = this.fastRoute(message);
    if (quickRoute) {
      console.log(`[IntentRouter] 快速路由: ${quickRoute.intent} (${quickRoute.route})`);
      return quickRoute;
    }

    // 兜底默认走 rag（校园问答主场景），RAG 管道内部已有"无可靠来源→纯 LLM"降级
    const fallback = this._fallbackRoute(message);

    // 需要 LLM 分类且配置允许时才调用（默认关闭，避免每条消息多一次 LLM 调用）
    try {
      const config = require("../config");
      if (config.rag?.intentClassifyEnabled) {
        return await this.classify(message);
      }
    } catch (err) {
      console.warn("[IntentRouter] 读取 intentClassifyEnabled 失败，走兜底:", err.message);
    }

    return fallback;
  }

  /**
   * 兜底路由：默认知识问答（rag）
   */
  _fallbackRoute(_message) {
    return {
      intent: INTENT_TYPES.KNOWLEDGE_QUERY,
      confidence: 0.3,
      params: {},
      route: "rag",
      tool: null,
      reason: "兜底：默认走知识库检索",
    };
  }
}

module.exports = { IntentRouter, INTENT_TYPES, ROUTE_MAP };
