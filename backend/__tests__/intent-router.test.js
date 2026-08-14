import { describe, it, expect, beforeEach, vi } from 'vitest';

// 模拟 config（避免读 .env）
vi.mock('../src/config', () => ({
  rag: {
    intentRoutingEnabled: true,
    intentClassifyEnabled: false,
  },
  ai: {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com/v2',
    model: 'test-model',
    maxTokens: 4000,
    temperature: 0.7,
    timeout: 60000,
  },
}));

let IntentRouter;
const { INTENT_TYPES } = require('../src/services/intent-router.service');

beforeEach(() => {
  for (const k of Object.keys(require.cache)) {
    if (k.includes('intent-router') || k.includes('ai.service')) delete require.cache[k];
  }
  const mod = require('../src/services/intent-router.service');
  IntentRouter = mod.IntentRouter;
});

function getRouter() {
  // fastRoute 是纯关键词路由（零 LLM），传 null 避免触发 AiService 初始化
  return new IntentRouter(null);
}

/**
 * fastRoute 是纯关键词路由（零 LLM），是路由正确性的核心。
 * 用例锁定：正向匹配（问候/多步任务）+ 不该被硬路由的边缘意图（应返回 null 走兜底 rag）。
 */
describe('IntentRouter.fastRoute', () => {
  const chatCases = [
    ['问候-你好', '你好', INTENT_TYPES.GENERAL_CHAT],
    ['问候-您好', '您好', INTENT_TYPES.GENERAL_CHAT],
    ['问候-hello', 'hello', INTENT_TYPES.GENERAL_CHAT],
    ['问候-hi', 'Hi', INTENT_TYPES.GENERAL_CHAT],
    ['问候-早上好', '早上好', INTENT_TYPES.GENERAL_CHAT],
    ['感谢', '谢谢', INTENT_TYPES.GENERAL_CHAT],
    ['告别', '再见', INTENT_TYPES.GENERAL_CHAT],
  ];

  for (const [desc, input, intent] of chatCases) {
    it(`正向匹配 chat：${desc} → chat/${intent}`, () => {
      const r = getRouter().fastRoute(input);
      expect(r).not.toBeNull();
      expect(r.intent).toBe(intent);
      expect(r.route).toBe('chat');
      expect(r.confidence).toBeGreaterThan(0);
    });
  }

  const agentCases = [
    ['多步-复习计划', '帮我制定一个期末复习计划', INTENT_TYPES.COMPLEX_TASK],
    ['多步-综合对比', '综合对比一下两个方案', INTENT_TYPES.COMPLEX_TASK],
    ['多步-规划时间线', '帮我规划考研时间线', INTENT_TYPES.COMPLEX_TASK],
    ['多步-权衡', '帮我权衡一下利弊', INTENT_TYPES.COMPLEX_TASK],
  ];

  for (const [desc, input, intent] of agentCases) {
    it(`正向匹配 agent：${desc} → agent/${intent}`, () => {
      const r = getRouter().fastRoute(input);
      expect(r).not.toBeNull();
      expect(r.intent).toBe(intent);
      expect(r.route).toBe('agent');
      expect(r.confidence).toBeGreaterThan(0);
    });
  }

  // 不应被硬路由的意图：知识问答/校园生活/政策咨询 → null（走兜底 rag）
  const nullCases = [
    ['知识问答-食堂', '学校食堂几点关门'],
    ['知识问答-图书馆', '图书馆怎么借书'],
    ['知识问答-奖学金', '怎么申请奖学金'],
    ['知识问答-算法题', '什么是数据结构'],
    ['校园生活-宿舍', '宿舍几点熄灯'],
    ['考试咨询', '期末考试安排'],
    ['模糊闲聊', '今天天气怎么样'],
    ['复杂-但带闲聊词尾', '你好，请问食堂在哪'],
  ];
  for (const [desc, input] of nullCases) {
    it(`不硬路由：${desc} → null（走兜底 rag）`, () => {
      const r = getRouter().fastRoute(input);
      expect(r).toBeNull();
    });
  }
});

describe('IntentRouter.route', () => {
  it('fastRoute 命中时直接返回，不调用 LLM', async () => {
    const router = getRouter();
    const r = await router.route('你好');
    expect(r.route).toBe('chat');
    expect(r.intent).toBe(INTENT_TYPES.GENERAL_CHAT);
  });

  it('未命中时兜底默认走 rag（校园问答主场景）', async () => {
    const router = getRouter();
    const r = await router.route('学校食堂几点关门');
    expect(r.route).toBe('rag');
    expect(r.intent).toBe(INTENT_TYPES.KNOWLEDGE_QUERY);
    expect(r.reason).toContain('兜底');
  });

  it('兜底 rag 的 confidence 大于 0', async () => {
    const r = await getRouter().route('软件工程面试题有哪些');
    expect(r.confidence).toBeGreaterThan(0);
  });
});

describe('IntentRouter.classify (LLM 兜底)', () => {
  it('LLM 返回合法 JSON 时解析为路由结果', async () => {
    const fakeAi = {
      getCompletion: async () => ({
        content: '{"intent": "general_chat", "confidence": 0.9, "params": {}, "reason": "闲聊"}',
        isMock: false,
      }),
    };
    const router = new IntentRouter(fakeAi);
    const r = await router.classify('帮我写首诗');
    expect(r.route).toBe('chat');
    expect(r.intent).toBe(INTENT_TYPES.GENERAL_CHAT);
    expect(r.confidence).toBe(0.9);
  });

  it('LLM 返回无法解析的内容时走兜底 rag', async () => {
    const fakeAi = {
      getCompletion: async () => ({ content: '抱歉我无法分类', isMock: false }),
    };
    const router = new IntentRouter(fakeAi);
    const r = await router.classify('食堂几点关门');
    expect(r.route).toBe('rag');
    expect(r.intent).toBe(INTENT_TYPES.KNOWLEDGE_QUERY);
  });

  it('LLM 超时（15s）时走兜底 rag', async () => {
    const fakeAi = {
      getCompletion: () => new Promise(() => {}), // 永不 resolve，触发 race 超时
    };
    const router = new IntentRouter(fakeAi);
    const r = await router.classify('什么都不会超时的问题');
    expect(r.route).toBe('rag');
  }, 20000); // 超时用例需要等 15s race 触发
});
