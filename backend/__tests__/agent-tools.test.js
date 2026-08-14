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
  agent: {
    toolEnabled: true,
    decideTimeoutMs: 15000,
    toolTimeoutMs: 15000,
  },
}));

// 模拟 rag.service / ai.service，避免真实初始化向量库
vi.mock('../src/services/rag.service', () => {
  class FakeRagService {
    async chat(query, history, opts) {
      return {
        reply: `模拟知识库回答（${query}）`,
        sources: [{ title: '测试文档' }],
        isMock: true,
      };
    }
  }
  return { RagService: FakeRagService };
});

vi.mock('../src/services/ai.service', () => {
  class FakeAiService {
    async getCompletion(message, history, opts) {
      return { content: '模拟 LLM 回答', isMock: true, model: 'mock' };
    }
    async *getCompletionStream(message, history) {
      yield { content: '模拟', done: false };
      yield { content: '回答', done: false };
      yield { content: '', done: true };
    }
  }
  return { aiService: new FakeAiService(), AiService: FakeAiService };
});

let registryMod;
let agentTools;
let agentMod;

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(require.cache)) {
    if (k.includes('tool-registry') || k.includes('agent-tools') || k.includes('agent.service')) {
      delete require.cache[k];
    }
  }
  registryMod = require('../src/services/tool-registry.service');
  agentTools = require('../src/services/agent-tools');
  agentMod = require('../src/services/agent.service');
});

describe('ToolRegistry（移植自存档版）', () => {
  it('注册/查询/移除工具', () => {
    const { ToolRegistry } = registryMod;
    const reg = new ToolRegistry();
    const handler = vi.fn(async () => 'ok');
    reg.register({ name: 'test_tool', description: 'd', handler });
    expect(reg.getTool('test_tool')).not.toBeNull();
    expect(reg.getToolNames()).toContain('test_tool');
    expect(reg.unregister('test_tool')).toBe(true);
    expect(reg.getTool('test_tool')).toBeNull();
  });

  it('缺少 name/handler 时拒绝注册', () => {
    const { ToolRegistry } = registryMod;
    const reg = new ToolRegistry();
    expect(() => reg.register({ name: 'x' })).toThrow('name 和 handler');
  });

  it('执行工具返回 handler 结果', async () => {
    const { ToolRegistry } = registryMod;
    const reg = new ToolRegistry();
    reg.register({ name: 'echo', handler: async (args) => `echo:${args.v}` });
    expect(await reg.executeTool('echo', { v: 42 })).toBe('echo:42');
  });

  it('未知工具/禁用工具返回语义化提示', async () => {
    const { ToolRegistry } = registryMod;
    const reg = new ToolRegistry();
    reg.register({ name: 't', handler: async () => 'ok' });
    reg.setEnabled('t', false);
    expect(await reg.executeTool('unknown', {})).toContain('未知工具');
    expect(await reg.executeTool('t', {})).toContain('已禁用');
  });

  it('handler 抛错时返回失败信息而非 reject', async () => {
    const { ToolRegistry } = registryMod;
    const reg = new ToolRegistry();
    reg.register({ name: 'boom', handler: async () => { throw new Error('boom!'); } });
    const r = await reg.executeTool('boom', {});
    expect(r).toContain('执行失败');
    expect(r).toContain('boom');
  });

  it('超时返回语义化提示（不 reject）', async () => {
    const { ToolRegistry } = registryMod;
    const reg = new ToolRegistry();
    reg.register({
      name: 'slow',
      timeoutMs: 50,
      handler: async () => { await new Promise(r => setTimeout(r, 500)); return 'late'; },
    });
    const r = await reg.executeTool('slow', {});
    expect(r).toContain('执行超时');
  });

  it('getToolSchemas 输出 OpenAI function calling 格式', () => {
    const { ToolRegistry } = registryMod;
    const reg = new ToolRegistry();
    reg.register({
      name: 'calc', description: '计算',
      parameters: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
      handler: async () => '0',
    });
    const schemas = reg.getToolSchemas();
    expect(schemas[0].type).toBe('function');
    expect(schemas[0].function.name).toBe('calc');
    expect(schemas[0].function.parameters.properties.a.type).toBe('number');
  });
});

describe('agent-tools（内置工具）', () => {
  it('注册了 search_knowledge_base 与 calculate', () => {
    const names = agentTools.getToolNames();
    expect(names).toContain('search_knowledge_base');
    expect(names).toContain('calculate');
  });

  it('search_knowledge_base 工具契约：返回字符串且不抛错（走真实 rag 链路，CJS mock 不生效）', async () => {
    // ⚠️ CLAUDE.md 记录的坑：vitest 4 中 vi.mock 对 CJS require 链不生效，
    // 此处执行的是真实 rag.service（本地向量库）。测试只锁定工具契约：
    // 输出为字符串、以"检索结果/知识库检索失败"开头（不抛错、可降级）。
    const r = await agentTools.executeTool('search_knowledge_base', { query: '食堂几点关门' });
    expect(typeof r).toBe('string');
    expect(r.length).toBeGreaterThan(0);
    expect(/^(检索结果|知识库检索失败|工具.*超时)/.test(r)).toBe(true);
  });

  it('calculate 用 mathjs 安全求值', async () => {
    expect(await agentTools.executeTool('calculate', { expression: '2+3*4' })).toBe('2+3*4 = 14');
    expect(await agentTools.executeTool('calculate', { expression: 'sqrt(16)' })).toBe('sqrt(16) = 4');
  });

  it('calculate 对非法表达式返回失败信息（不抛错）', async () => {
    const r = await agentTools.executeTool('calculate', { expression: '1/0+??' });
    expect(r).toContain('计算失败');
  });
});

describe('AgentService（单轮工具调度）', () => {
  it('decide：LLM 返回合法 JSON 时解析工具与参数', async () => {
    const fakeAi = {
      getCompletion: async () => ({
        content: '{"tool": "search_knowledge_base", "args": {"query": "食堂"}, "reason": "知识问题"}',
        isMock: false,
      }),
    };
    const svc = new agentMod.AgentService(fakeAi);
    const d = await svc.decide('食堂几点关门');
    expect(d.tool).toBe('search_knowledge_base');
    expect(d.args.query).toBe('食堂');
  });

  it('decide：tool 为 null 时直接回答', async () => {
    const fakeAi = {
      getCompletion: async () => ({ content: '{"tool": null, "args": {}, "reason": "无需工具"}', isMock: false }),
    };
    const svc = new agentMod.AgentService(fakeAi);
    const d = await svc.decide('你好呀');
    expect(d.tool).toBeNull();
  });

  it('decide：LLM 请求不可用工具时降级直接回答', async () => {
    const fakeAi = {
      getCompletion: async () => ({ content: '{"tool": "query_grades", "args": {}, "reason": "x"}', isMock: false }),
    };
    const svc = new agentMod.AgentService(fakeAi);
    const d = await svc.decide('查成绩');
    expect(d.tool).toBeNull();
    expect(d.reason).toContain('不可用');
  });

  it('decide：无法解析 JSON 时降级直接回答', async () => {
    const fakeAi = {
      getCompletion: async () => ({ content: '我不是 JSON', isMock: false }),
    };
    const svc = new agentMod.AgentService(fakeAi);
    const d = await svc.decide('随便问问');
    expect(d.tool).toBeNull();
  });

  it('chatStream：决策 → 工具执行 → 流式回答（事件齐全）', async () => {
    const fakeAi = {
      getCompletion: async () => ({
        content: '{"tool": "calculate", "args": {"expression": "2+2"}, "reason": "计算"}',
        isMock: false,
      }),
      async *getCompletionStream() {
        yield { content: '4', done: false };
        yield { content: '', done: true };
      },
    };
    const svc = new agentMod.AgentService(fakeAi);
    const events = [];
    for await (const ev of svc.chatStream('2+2等于多少', [])) {
      events.push(ev);
    }
    const types = events.map(e => e.type);
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types).toContain('content');
    const toolCall = events.find(e => e.type === 'tool_call');
    expect(toolCall.tool_call.name).toBe('calculate');
    const toolResult = events.find(e => e.type === 'tool_result');
    expect(toolResult.tool_result.content).toContain('= 4');
    const done = events.find(e => e.type === 'content' && e.content.done === true) || events.find(e => e.type === 'content' && e.done === true);
    expect(done).toBeTruthy();
  });
});
