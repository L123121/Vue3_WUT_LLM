import { describe, it, expect, beforeEach, vi } from 'vitest';

// 模拟 config（避免读 .env）— 用 vi.hoisted 不需要，因为 mock 在 import 前注册
vi.mock('../src/config', () => ({
  ai: {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com/v2',
    model: 'test-model',
    maxTokens: 4000,
    temperature: 0.7,
    timeout: 60000,
  },
}));

// 模拟空工具注册表（intent-router require 了 agent-tools）
vi.mock('../src/services/agent-tools', () => ({
  toolRegistry: { getToolSchemas: () => [], executeTool: vi.fn(), getTool: () => null },
}));

let IntentRouter;

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(require.cache)) {
    if (k.includes('intent-router') || k.includes('ai.service')) delete require.cache[k];
  }
  const mod = require('../src/services/intent-router.service');
  IntentRouter = mod.IntentRouter;
});

function getRouter() {
  // fastRoute 不依赖 aiService，传 null 避免触发 AiService 初始化
  return new IntentRouter(null);
}

/**
 * fastRoute 是纯关键词路由（零 LLM），是误判风险最高、最该有单测的路径。
 * 这些用例既锁定正向匹配，也锁定"不该被硬路由"的边缘意图（应返回 null 交 LLM）。
 */
describe('IntentRouter.fastRoute', () => {
  const cases = [
    // [描述, 输入, 期望 intent, 期望 route, 期望 tool]
    ['查成绩', '帮我查一下成绩', 'query_grades', 'simple', 'query_grades'],
    ['查成绩-我的成绩', '我的成绩怎么样', 'query_grades', 'simple', 'query_grades'],
    ['查GPA', 'GPA多少', 'query_gpa', 'simple', 'calculate_gpa'],
    ['查GPA-绩点', '绩点多少', 'query_gpa', 'simple', 'calculate_gpa'],
    ['查未评教成绩', '未评教的成绩能查吗', 'query_ungraded_scores', 'simple', 'query_ungraded_scores'],
    ['查课表', '我明天有什么课', 'query_schedule', 'simple', 'query_course_schedule'],
    ['查课表-课表关键词', '这周课表', 'query_schedule', 'simple', 'query_course_schedule'],
    ['查考试', '期末考试安排', 'query_exams', 'simple', 'query_exam_schedule'],
    ['数学计算-算一下', '算一下 3+5', 'calculate', 'simple', 'calculate'],
    ['选课可行性', '我能选数据结构课吗', 'course_feasibility', 'react', null],
    ['选课可行性-先修', '这门课有先修要求吗', 'course_feasibility', 'react', null],
    ['成绩分析', '分析一下我的成绩趋势', 'grade_analysis', 'analysis', null],
    ['校园信息-校历', '校历', 'knowledge_query', 'knowledge', 'search_knowledge_base'],
    ['校园信息-地址', '学校地址在哪里', 'knowledge_query', 'knowledge', 'search_knowledge_base'],
    ['问候', '你好', 'general_chat', 'chat', null],
    ['感谢', '谢谢', 'general_chat', 'chat', null],
  ];

  for (const [desc, input, intent, route, tool] of cases) {
    it(`正向匹配：${desc} → ${route}/${intent}`, () => {
      const r = getRouter().fastRoute(input);
      expect(r).not.toBeNull();
      expect(r.intent).toBe(intent);
      expect(r.route).toBe(route);
      expect(r.tool).toBe(tool);
      expect(r.confidence).toBeGreaterThan(0);
    });
  }

  // 边缘意图：低置信正则已裁剪，这些应返回 null 交给 LLM/ReAct，不被硬路由
  const nullCases = [
    ['成绩不好求助', '我成绩不好怎么办'],
    ['校园生活', '食堂今天有什么菜'],
    ['考研咨询', '考研要准备什么'],
    ['奖学金', '怎么申请奖学金'],
    ['模糊闲聊', '今天天气真好'],
    // 已知盲点：fastRoute 的 GPA 正则用 ^ 锚定开头，"我的GPA是多少" 不命中，
    // 会落到 LLM 分类。此处锁定现状，待正则放宽后改为正向用例。
    ['查GPA-我的GPA是多少（盲点，落LLM）', '我的GPA是多少'],
  ];
  for (const [desc, input] of nullCases) {
    it(`不硬路由：${desc} → null（交 LLM）`, () => {
      const r = getRouter().fastRoute(input);
      expect(r).toBeNull();
    });
  }

  it('route() 命中快速路由时不调用 LLM', async () => {
    const router = getRouter();
    // fastRoute 能命中时，route() 应直接返回，不触发 classify（无需 mock aiService）
    const r = await router.route('帮我查成绩');
    expect(r.route).toBe('simple');
    expect(r.tool).toBe('query_grades');
  });

  it('参数提取：学期格式 2024-2025-1', () => {
    const r = getRouter().fastRoute('查一下 2024-2025-1 学期成绩');
    expect(r.params.semester).toBe('2024-2025-1');
  });
});
