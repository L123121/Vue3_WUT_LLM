"use strict";

const { AiService } = require('./ai.service');
const { toolRegistry } = require('./agent-tools');

/**
 * IntentRouter — 意图识别与任务路由层
 *
 * 对应架构图中的 "意图识别层 (NLU)" + "任务路由"
 *
 * 职责：
 * 1. 分析用户消息，识别意图类型
 * 2. 提取关键参数（课程名、学期等）
 * 3. 根据意图复杂度路由到不同的处理路径：
 *    - simple: 单轮工具调用（查成绩、查课表、查考试）
 *    - react: ReAct 多步循环（选课可行性分析）
 *    - analysis: 取数 + LLM 分析（成绩趋势分析）
 *    - knowledge: 知识库检索
 *    - chat: 普通对话
 */

// 意图类型定义
const INTENT_TYPES = {
  QUERY_GRADES: 'query_grades',           // 查成绩 → simple
  QUERY_SCHEDULE: 'query_schedule',       // 查课表 → simple
  QUERY_EXAMS: 'query_exams',             // 查考试 → simple
  QUERY_GPA: 'query_gpa',                 // 查GPA → simple
  QUERY_UNGRADED: 'query_ungraded_scores',// 查未评教隐藏成绩 → simple
  COURSE_FEASIBILITY: 'course_feasibility', // 选课可行性 → react
  GRADE_ANALYSIS: 'grade_analysis',       // 成绩分析 → analysis
  KNOWLEDGE_QUERY: 'knowledge_query',     // 校园百科 → knowledge
  GENERAL_CHAT: 'general_chat',           // 普通对话 → chat
};

// 意图路由表：意图类型 → { route, tool, description }
const ROUTE_MAP = {
  [INTENT_TYPES.QUERY_GRADES]:     { route: 'simple', tool: 'query_grades' },
  [INTENT_TYPES.QUERY_SCHEDULE]:   { route: 'simple', tool: 'query_course_schedule' },
  [INTENT_TYPES.QUERY_EXAMS]:      { route: 'simple', tool: 'query_exam_schedule' },
  [INTENT_TYPES.QUERY_GPA]:        { route: 'simple', tool: 'calculate_gpa' },
  [INTENT_TYPES.QUERY_UNGRADED]:   { route: 'simple', tool: 'query_ungraded_scores' },
  [INTENT_TYPES.COURSE_FEASIBILITY]: { route: 'react', tool: null },
  [INTENT_TYPES.GRADE_ANALYSIS]:   { route: 'analysis', tool: null },
  [INTENT_TYPES.KNOWLEDGE_QUERY]:  { route: 'knowledge', tool: 'search_knowledge_base' },
  [INTENT_TYPES.GENERAL_CHAT]:     { route: 'chat', tool: null },
};

/**
 * 轻量级意图分类 prompt
 * 只做分类，不做推理 — 快、省 token
 */
const CLASSIFICATION_PROMPT = `你是一个意图分类器。请分析用户的消息，返回 JSON 格式的分类结果。

可能的意图类型：
- query_grades: 查询成绩（如"我成绩怎么样"、"查一下上学期成绩"）
- query_schedule: 查询课表（如"我明天有什么课"、"这周课表"）
- query_exams: 查询考试（如"考试安排"、"什么时候考试"）
- query_gpa: 查询绩点/GPA（如"我的GPA是多少"、"绩点多少"、"平均绩点"）
- query_ungraded_scores: 查询未评教课程的隐藏成绩（如"未评教的成绩"、"隐藏成绩"、"帮我回填成绩"、"学业监测"、"查一下没评教的课考了多少分"）
- course_feasibility: 选课可行性分析（如"我能选XX课吗"、"XX课有先修要求吗"、"选XX会不会和时间冲突"）
- grade_analysis: 成绩分析（如"分析我的成绩"、"绩点趋势"、"我这学期表现怎么样"、"各科成绩分析"）
- knowledge_query: 校园信息查询（如"学校地址"、"图书馆几点关门"、"校车时刻"、"学校概况"）
- general_chat: 普通对话/闲聊（不属于以上任何类别）

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
  "params": {
    "courseName": "课程名称（如有）",
    "semester": "学期（如有）",
    "topic": "查询主题（如有）"
  },
  "reason": "简短分类理由"
}`;

class IntentRouter {
  constructor(aiService = null) {
    this.aiService = aiService || new AiService();
  }

  /**
   * 分析用户消息，返回意图分类结果
   * @param {string} message - 用户消息
   * @returns {Promise<{intent: string, confidence: number, params: object, route: string}>}
   */
  async classify(message) {
    if (!this.aiService.apiKey) {
      // Mock 模式：使用关键词规则
      return this._mockClassify(message);
    }

    try {
      const prompt = CLASSIFICATION_PROMPT.replace('{message}', message);
      // 分类调用加 10 秒超时，超时就走关键词匹配
      const response = await Promise.race([
        this.aiService.getCompletion(prompt, []),
        new Promise((resolve) =>
          setTimeout(() => resolve({ content: '', isMock: true, _timeout: true }), 10000)
        ),
      ]);
      if (response._timeout) {
        console.warn('[IntentRouter] LLM 分类超时(10s)，降级为关键词匹配');
        return this._fallbackClassify(message);
      }

      const content = response.content.trim();
      // 提取 JSON（处理可能的 markdown 代码块）
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('[IntentRouter] 无法从 LLM 响应中提取 JSON:', content);
        return this._fallbackClassify(message);
      }

      const result = JSON.parse(jsonMatch[0]);
      const intent = result.intent || INTENT_TYPES.GENERAL_CHAT;
      const routeInfo = ROUTE_MAP[intent] || ROUTE_MAP[INTENT_TYPES.GENERAL_CHAT];

      return {
        intent,
        confidence: result.confidence || 0.5,
        params: result.params || {},
        reason: result.reason || '',
        route: routeInfo.route,
        tool: routeInfo.tool,
      };
    } catch (err) {
      console.error('[IntentRouter] 意图分类失败:', err.message);
      return this._fallbackClassify(message);
    }
  }

  /**
   * 快速路由：只做关键词匹配，不调用 LLM
   * 用于在高频简单查询上跳过 LLM 调用
   */
  fastRoute(message) {
    const lower = message.toLowerCase();

    // 选课可行性关键词（需要 ReAct 多步）
    if (/(我能选|可以选|能不能选|选.*可以|选.*不行|先修|前置|冲突|撞课|时间.*撞)/.test(lower)) {
      return {
        intent: INTENT_TYPES.COURSE_FEASIBILITY,
        confidence: 0.7,
        params: { courseName: this._extractCourseName(message) },
        route: 'react',
        tool: null,
        reason: '关键词匹配：选课可行性',
      };
    }

    // 成绩分析关键词（需要先匹配，避免被普通查成绩覆盖）
    if (/(分析|趋势|分析一下|趋势.*分析|各科.*分析)/.test(lower) && /成绩|绩点|GPA|学分/.test(lower)) {
      return {
        intent: INTENT_TYPES.GRADE_ANALYSIS,
        confidence: 0.75,
        params: {},
        route: 'analysis',
        tool: null,
        reason: '关键词匹配：成绩分析',
      };
    }

    // 查GPA（优先级高于查成绩，更精确匹配）
    if (/^(GPA|绩点|平均.*绩点|平均.*学分.*绩点|加权.*绩点|我的.*绩点|GPA.*多少|绩点.*多少)/i.test(lower)) {
      return {
        intent: INTENT_TYPES.QUERY_GPA,
        confidence: 0.85,
        params: { semester: this._extractSemester(message) },
        route: 'simple',
        tool: 'calculate_gpa',
        reason: '关键词匹配：查GPA',
      };
    }

    // 查成绩
    if (/(成绩|绩点|GPA|考了多少|多少分|成绩.*怎么样|成绩.*如何)/.test(lower)) {
      return {
        intent: INTENT_TYPES.QUERY_GRADES,
        confidence: 0.75,
        params: { semester: this._extractSemester(message) },
        route: 'simple',
        tool: 'query_grades',
        reason: '关键词匹配：查成绩',
      };
    }

    // 查未评教隐藏成绩
    if (/(未评教|隐藏.*成绩|隐藏.*分数|回填|学业监测|未.*评教|评教.*成绩)/.test(lower)) {
      return {
        intent: INTENT_TYPES.QUERY_UNGRADED,
        confidence: 0.85,
        params: { semester: this._extractSemester(message) },
        route: 'simple',
        tool: 'query_ungraded_scores',
        reason: '关键词匹配：查未评教成绩',
      };
    }

    // 查课表
    if (/(课表|课程表|明天.*课|今天.*课|这周.*课|周.*课|课.*表)/.test(lower)) {
      return {
        intent: INTENT_TYPES.QUERY_SCHEDULE,
        confidence: 0.75,
        params: {
          semester: this._extractSemester(message),
          day: this._extractDay(message),
          week: this._extractWeek(message),
        },
        route: 'simple',
        tool: 'query_course_schedule',
        reason: '关键词匹配：查课表',
      };
    }

    // 查考试
    if (/(考试|期末|考点|考场|座位号|监考)/.test(lower)) {
      return {
        intent: INTENT_TYPES.QUERY_EXAMS,
        confidence: 0.75,
        params: { semester: this._extractSemester(message) },
        route: 'simple',
        tool: 'query_exam_schedule',
        reason: '关键词匹配：查考试',
      };
    }

    // 数学计算
    if (/(计算|算一下|算算|等于多少|[\d]+\s*[+\-*/]\s*[\d]+)/.test(lower)) {
      return {
        intent: INTENT_TYPES.GENERAL_CHAT, // 计算通过工具层处理
        confidence: 0.6,
        params: {},
        route: 'simple',
        tool: 'calculate',
        reason: '关键词匹配：计算',
      };
    }

    // 校园信息
    if (/(校址|地址|电话|校车|校历|校区|概况|学校.*怎么样|学校.*介绍|图书馆|几点.*关门|开放.*时间)/.test(lower)) {
      return {
        intent: INTENT_TYPES.KNOWLEDGE_QUERY,
        confidence: 0.6,
        params: { topic: this._extractTopic(message) },
        route: 'knowledge',
        tool: 'search_knowledge_base',
        reason: '关键词匹配：校园信息',
      };
    }

    // 课程/专业查询
    if (/(课程|专业|培养方案|教学计划|选修|必修|通识|公选|任选|限选|学分|培养目标)/.test(lower)) {
      return {
        intent: INTENT_TYPES.KNOWLEDGE_QUERY,
        confidence: 0.65,
        params: { topic: '专业课程', category: '教务相关' },
        route: 'knowledge',
        tool: 'search_knowledge_base',
        reason: '关键词匹配：课程专业',
      };
    }

    // 就业/考研/出国
    if (/(就业|考研|出国|留学|毕业去向|就业率|考研率|工作|实习|招聘)/.test(lower)) {
      return {
        intent: INTENT_TYPES.KNOWLEDGE_QUERY,
        confidence: 0.6,
        params: { topic: '就业考研', category: '学校概况' },
        route: 'knowledge',
        tool: 'search_knowledge_base',
        reason: '关键词匹配：就业考研',
      };
    }

    // 奖学金/助学金
    if (/(奖学金|助学金|助学贷款|贫困补助|评优|评奖)/.test(lower)) {
      return {
        intent: INTENT_TYPES.KNOWLEDGE_QUERY,
        confidence: 0.65,
        params: { topic: '奖学金', category: '教务相关' },
        route: 'knowledge',
        tool: 'search_knowledge_base',
        reason: '关键词匹配：奖学金',
      };
    }

    // 宿舍/食堂/校园生活
    if (/(宿舍|寝室|食堂|饭堂|校园卡|一卡通|门禁|热水|网络|空调|洗衣机)/.test(lower)) {
      return {
        intent: INTENT_TYPES.KNOWLEDGE_QUERY,
        confidence: 0.6,
        params: { topic: '校园生活', category: '学校概况' },
        route: 'knowledge',
        tool: 'search_knowledge_base',
        reason: '关键词匹配：校园生活',
      };
    }

    // 转专业/休学/请假
    if (/(转专业|休学|退学|复学|请假|延期|毕业|结业|肄业)/.test(lower)) {
      return {
        intent: INTENT_TYPES.KNOWLEDGE_QUERY,
        confidence: 0.6,
        params: { topic: '学籍教务', category: '教务相关' },
        route: 'knowledge',
        tool: 'search_knowledge_base',
        reason: '关键词匹配：学籍教务',
      };
    }

    // 体测/体育
    if (/(体测|体育|运动会|跑步|校园跑|健康|体检)/.test(lower)) {
      return {
        intent: INTENT_TYPES.KNOWLEDGE_QUERY,
        confidence: 0.55,
        params: { topic: '体育健康', category: '学校概况' },
        route: 'knowledge',
        tool: 'search_knowledge_base',
        reason: '关键词匹配：体育健康',
      };
    }

    // 导师/教师
    if (/(导师|老师|教师|教授|博导|硕导|辅导员|班主任)/.test(lower)) {
      return {
        intent: INTENT_TYPES.KNOWLEDGE_QUERY,
        confidence: 0.55,
        params: { topic: '教师导师' },
        route: 'knowledge',
        tool: 'search_knowledge_base',
        reason: '关键词匹配：教师导师',
      };
    }

    // 时间/日期/天气
    if (/(几点了|今天.*号|星期几|什么日子|天气|温度|下雨)/.test(lower)) {
      return {
        intent: INTENT_TYPES.GENERAL_CHAT,
        confidence: 0.5,
        params: {},
        route: 'chat',
        tool: null,
        reason: '关键词匹配：时间天气',
      };
    }

    // 问候语
    if (/(你好|您好|嗨|早上好|晚上好|下午好|hello|hi)/.test(lower)) {
      return {
        intent: INTENT_TYPES.GENERAL_CHAT,
        confidence: 0.9,
        params: {},
        route: 'chat',
        tool: null,
        reason: '关键词匹配：问候',
      };
    }

    // 感谢/告别
    if (/(谢谢|感谢|再见|拜拜|好的|明白了|知道了|ok|好的吧)/.test(lower)) {
      return {
        intent: INTENT_TYPES.GENERAL_CHAT,
        confidence: 0.8,
        params: {},
        route: 'chat',
        tool: null,
        reason: '关键词匹配：感谢告别',
      };
    }

    // 帮忙/求助类（返回较低置信度，让 route() 决定是否走 LLM 分类）
    if (/(请问|有没有|如何|怎么|怎样|什么.*意思|什么意思)/.test(lower)) {
      return null; // 走 LLM 分类或 fallback
    }

    // 默认：需要 LLM 分类
    return null;
  }

  /**
   * 完整路由：先尝试快速路由，失败则调用 LLM 分类
   */
  async route(message) {
    // 1. 先尝试快速路由（零 LLM 调用）
    const quickRoute = this.fastRoute(message);
    if (quickRoute) {
      console.log(`[IntentRouter] 快速路由: ${quickRoute.intent} (${quickRoute.route})`);
      return quickRoute;
    }

    // 2. 快速路由无法确定，调用 LLM 分类
    console.log('[IntentRouter] 快速路由无法确定，调用 LLM 分类...');
    return await this.classify(message);
  }

  // ==================== 参数提取辅助方法 ====================

  _extractCourseName(message) {
    // 提取课程名：匹配 "XX课"、"XX课程"、"课程XX" 等模式
    const patterns = [
      /选[^，。！？]*?([^\s，。！？]{2,10})[课课]/,  // "选XX课"
      /([^\s，。！？]{2,15})[课课][^，。！？]*[是否能不能行]/,  // "XX课能不能选"
      /[能可]选[的]?[^，。！？]*?([^\s，。！？]{2,10})/,  // "能选XX"
    ];
    for (const p of patterns) {
      const m = message.match(p);
      if (m && m[1] && m[1].length >= 2) return m[1];
    }
    return message.replace(/[我能选吗可以不行有没有冲突先修]/g, '').trim().slice(0, 15) || null;
  }

  _extractSemester(message) {
    const m = message.match(/(\d{4}-\d{4}[-/]\d)/);
    return m ? m[1] : null;
  }

  _extractDay(message) {
    const days = { '周一': '周一', '周二': '周二', '周三': '周三', '周四': '周四', '周五': '周五', '周六': '周六', '周日': '周日',
                   '星期一': '周一', '星期二': '周二', '星期三': '周三', '星期四': '周四', '星期五': '周五' };
    for (const [k, v] of Object.entries(days)) {
      if (message.includes(k)) return v;
    }
    return null;
  }

  _extractWeek(message) {
    const m = message.match(/第([一二三四五六七\d]+)周/);
    if (!m) return null;
    const numMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7 };
    return parseInt(m[1]) || numMap[m[1]] || null;
  }

  _extractTopic(message) {
    const topics = {
      '地址|校区|在哪里|怎么走': '校区地址',
      '电话|联系|热线': '联系电话',
      '校车|班车|交通': '校车时刻',
      '校历|假期|放假|开学': '校历',
      '概况|简介|介绍|历史': '概况',
      '图书馆|借书|座位|自习': '图书馆',
    };
    for (const [pattern, topic] of Object.entries(topics)) {
      if (new RegExp(pattern).test(message)) return topic;
    }
    return '概况';
  }

  // ==================== Mock / Fallback ====================

  _mockClassify(message) {
    return this._fallbackClassify(message);
  }

  _fallbackClassify(message) {
    const quick = this.fastRoute(message);
    if (quick) return quick;

    // 未识别的消息也走知识库 + LLM，而不是纯 LLM
    // 这样即使 LLM 无法分类，也能用知识库检索兜底
    return {
      intent: INTENT_TYPES.KNOWLEDGE_QUERY,
      confidence: 0.3,
      params: { topic: 'general' },
      route: 'knowledge',
      tool: 'search_knowledge_base',
      reason: 'fallback: 默认走知识库检索',
    };
  }
}

module.exports = { IntentRouter, INTENT_TYPES, ROUTE_MAP };
