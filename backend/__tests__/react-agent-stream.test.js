import { describe, it, expect, beforeEach, vi } from 'vitest';

// 模拟 config（避免读 .env）— 用 vi.hoisted 确保提升
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

// 模拟空工具注册表
vi.mock('../src/services/agent-tools', () => ({
  toolRegistry: {
    getToolSchemas: () => [],
    executeTool: vi.fn(),
    getTool: () => null,
  },
}));

let ReactAgent;
let AiService;

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(require.cache)) {
    if (k.includes('react-agent') || k.includes('ai.service')) delete require.cache[k];
  }
  const mod = require('../src/services/react-agent.service');
  ReactAgent = mod.ReactAgent;
  const aiMod = require('../src/services/ai.service');
  AiService = aiMod.AiService;
});

function getAgent(executeTool = vi.fn().mockResolvedValue('ok')) {
  const ai = new AiService();
  ai.anthropicMode = false;
  return new ReactAgent(ai, {
    getToolSchemas: () => [],
    executeTool,
    getTool: () => null,
  });
}

/**
 * 生成一个 async generator，模拟 _callLLMWithToolsStream 的输出
 * @param {Array} events - 预定义的事件序列 [{type:'delta'|'end', ...}]
 */
function fakeStream(events) {
  return async function* () {
    for (const e of events) yield e;
  };
}

describe('ReactAgent 流式循环：文本最终答案逐 token 输出', () => {
  it('LLM 直接回复文本时，delta 透传 + done 收尾', async () => {
    const agent = getAgent();
    // 直接 stub 实例方法，绕过真实 HTTP
    agent._callLLMWithToolsStream = fakeStream([
      { type: 'delta', content: '你好' },
      { type: 'delta', content: '世界' },
      { type: 'end', tool_calls: null, content: '你好世界' },
    ]);

    const events = [];
    for await (const ev of agent.execute('hi', [], { userId: 'u1', conversationId: 'c1' })) {
      events.push(ev);
    }

    // delta 实时透传为 content 事件
    const contents = events.filter(e => e.type === 'content' && e.content).map(e => e.content);
    expect(contents).toEqual(['你好', '世界']);
    // 末尾有 done 标记
    expect(events.some(e => e.type === 'content' && e.done)).toBe(true);
  });

  it('LLM 返回空内容时给兜底文案 + done', async () => {
    const agent = getAgent();
    agent._callLLMWithToolsStream = fakeStream([
      { type: 'end', tool_calls: null, content: '' },
    ]);

    const events = [];
    for await (const ev of agent.execute('hi', [], { userId: 'u1', conversationId: 'c1' })) {
      events.push(ev);
    }
    const contents = events.filter(e => e.type === 'content' && e.content).map(e => e.content).join('');
    expect(contents).toContain('抱歉');
    expect(events.some(e => e.type === 'content' && e.done)).toBe(true);
  });
});

describe('ReactAgent 无进展循环检测', () => {
  it('连续 2 次相同工具调用 → 注入收尾提示，第 3 次 LLM 直接回答', async () => {
    const executeTool = vi.fn().mockResolvedValue('成绩数据');
    const agent = getAgent(executeTool);

    let callIdx = 0;
    agent._callLLMWithToolsStream = async function* () {
      callIdx++;
      if (callIdx <= 2) {
        // 前两次：都调 query_grades({})
        yield { type: 'end', tool_calls: [{ id: `c${callIdx}`, type: 'function', function: { name: 'query_grades', arguments: '{}' } }], content: '' };
      } else {
        // 第三次：直接文本回答（收尾）
        yield { type: 'delta', content: '这是最终结论' };
        yield { type: 'end', tool_calls: null, content: '这是最终结论' };
      }
    };

    const events = [];
    for await (const ev of agent.execute('查成绩', [], { userId: 'u1', conversationId: 'c1' })) {
      events.push(ev);
    }

    // 工具执行了 2 次（第 3 次 LLM 直接回答）
    expect(executeTool).toHaveBeenCalledTimes(2);
    // 最终有 content 输出
    const contents = events.filter(e => e.type === 'content' && e.content).map(e => e.content).join('');
    expect(contents).toContain('这是最终结论');
    expect(events.some(e => e.type === 'content' && e.done)).toBe(true);
  });

  it('不同工具调用不触发循环检测', async () => {
    const executeTool = vi.fn().mockResolvedValue('数据');
    const agent = getAgent(executeTool);

    let callIdx = 0;
    agent._callLLMWithToolsStream = async function* () {
      callIdx++;
      if (callIdx === 1) {
        yield { type: 'end', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'query_grades', arguments: '{}' } }], content: '' };
      } else if (callIdx === 2) {
        // 不同工具 → 不算重复
        yield { type: 'end', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'query_course_schedule', arguments: '{}' } }], content: '' };
      } else {
        yield { type: 'delta', content: '结论' };
        yield { type: 'end', tool_calls: null, content: '结论' };
      }
    };

    const events = [];
    for await (const ev of agent.execute('查成绩和课表', [], { userId: 'u1', conversationId: 'c1' })) {
      events.push(ev);
    }
    // 两种不同工具各执行一次
    expect(executeTool).toHaveBeenCalledTimes(2);
  });
});

describe('ReactAgent._applyDelta SSE 解析（纯函数）', () => {
  function newState() {
    return { contentAccum: '', toolCallMap: new Map(), hasToolCalls: false, anthropic: false };
  }
  function getAgent() {
    const ai = new AiService();
    ai.anthropicMode = false;
    return new ReactAgent(ai, { getToolSchemas: () => [], executeTool: () => null, getTool: () => null });
  }

  it('OpenAI 文本 delta 累积并返回', () => {
    const agent = getAgent();
    const state = newState();
    expect(agent._applyDelta({ choices: [{ delta: { content: '你' } }] }, state)).toBe('你');
    expect(agent._applyDelta({ choices: [{ delta: { content: '好' } }] }, state)).toBe('好');
    expect(state.contentAccum).toBe('你好');
    expect(state.hasToolCalls).toBe(false);
  });

  it('OpenAI tool_calls 分片按 index 拼接', () => {
    const agent = getAgent();
    const state = newState();
    // 第一片：id + name
    agent._applyDelta({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'query_grades', arguments: '' } }] } }] }, state);
    expect(state.hasToolCalls).toBe(true);
    // 第二片：arguments 分片
    agent._applyDelta({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"semes' } }] } }] }, state);
    // 第三片
    agent._applyDelta({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ter":"2025"}' } }] } }] }, state);

    const tc = state.toolCallMap.get(0);
    expect(tc.id).toBe('call_1');
    expect(tc.function ?? tc).toBeDefined();
    expect(tc.name).toBe('query_grades');
    expect(tc.arguments).toBe('{"semester":"2025"}');
  });

  it('OpenAI 多工具并行按 index 区分', () => {
    const agent = getAgent();
    const state = newState();
    agent._applyDelta({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'c2', function: { name: 'calculate', arguments: '{}' } }] } }] }, state);
    agent._applyDelta({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'query_grades', arguments: '{}' } }] } }] }, state);
    expect(state.toolCallMap.size).toBe(2);
    expect(state.toolCallMap.get(0).id).toBe('c1');
    expect(state.toolCallMap.get(1).id).toBe('c2');
  });

  it('无 choice 的事件返回 null', () => {
    const agent = getAgent();
    const state = newState();
    expect(agent._applyDelta({ foo: 'bar' }, state)).toBeNull();
    expect(state.contentAccum).toBe('');
  });

  it('Anthropic 模式：文本 delta 与 tool_use 拼接', () => {
    const ai = new AiService();
    ai.anthropicMode = true;
    const agent = new ReactAgent(ai, { getToolSchemas: () => [], executeTool: () => null, getTool: () => null });
    const state = { contentAccum: '', toolCallMap: new Map(), hasToolCalls: false, anthropic: true };

    expect(agent._applyDelta({ type: 'content_block_delta', delta: { text: '你好' } }, state)).toBe('你好');
    expect(state.contentAccum).toBe('你好');

    agent._applyDelta({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'query_grades' } }, state);
    expect(state.hasToolCalls).toBe(true);

    agent._applyDelta({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"x":1}' } }, state);
    expect(state.toolCallMap.get(0).arguments).toBe('{"x":1}');
    expect(state.toolCallMap.get(0).name).toBe('query_grades');
  });
});

describe('ReactAgent._truncateResult 智能截断', () => {
  function getAgent() {
    const ai = new AiService();
    ai.anthropicMode = false;
    return new ReactAgent(ai, { getToolSchemas: () => [], executeTool: () => null, getTool: () => null });
  }

  it('短内容原样返回', () => {
    const agent = getAgent();
    const short = '只有几行\n的成绩';
    expect(agent._truncateResult(short)).toBe(short);
  });

  it('长内容被截断且保留头尾', () => {
    const agent = getAgent();
    // 构造一个明确超过 MAX_TOOL_RESULT_LENGTH(3000) 的成绩报告
    const head = '📊 GPA 报告\n总绩点: 3.85\n';
    const body = Array.from({ length: 300 }, (_, i) => `课程${i} 90分 3学分`).join('\n');
    const tail = '\n💡 提示：回填成绩来自学业监测系统';
    const long = head + body + tail;
    // 确保测试输入确实超过阈值
    expect(long.length).toBeGreaterThan(3000);

    const truncated = agent._truncateResult(long);
    expect(truncated.length).toBeLessThan(long.length);
    // 头部总览保留
    expect(truncated).toContain('GPA 报告');
    expect(truncated).toContain('3.85');
    // 尾部提示保留
    expect(truncated).toContain('学业监测系统');
    // 标注了截断
    expect(truncated).toContain('智能截断');
  });

  it('非字符串原样返回', () => {
    const agent = getAgent();
    const obj = { a: 1 };
    expect(agent._truncateResult(obj)).toBe(obj);
    expect(agent._truncateResult(null)).toBeNull();
    expect(agent._truncateResult(undefined)).toBeUndefined();
  });
});
