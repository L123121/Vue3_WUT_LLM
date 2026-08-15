import { describe, it, expect, vi } from 'vitest';

// 模拟 config（避免读 .env / 构造 AiService 时的真实依赖）
vi.mock('../src/config', () => ({
  ai: {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com/v1',
    model: 'test-model',
    maxTokens: 4000,
    temperature: 0.7,
    timeout: 60000,
    fallback: null,
  },
}));

const { AiService } = require('../src/services/ai.service');

// 用 Object.create 拿到原型方法，避免构造器副作用（judgeService 等）
function makeService() {
  return Object.create(AiService.prototype);
}

/** 构造一个假的 SSE 响应（可异步迭代） */
function makeFakeRes(events) {
  return {
    statusCode: 200,
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield Buffer.from(e);
    },
  };
}

const provider = { anthropicMode: false, model: 'test-model' };

describe('AiService._parseStream 原生 function calling', () => {
  it('无 tools 参数时 tool_calls 为 null（向后兼容）', async () => {
    const svc = makeService();
    const res = makeFakeRes([
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const chunks = [];
    for await (const c of svc._parseStream(res, provider, {})) chunks.push(c);
    expect(chunks[0].content).toBe('你好');
    const done = chunks[chunks.length - 1];
    expect(done.done).toBe(true);
    expect(done.tool_calls).toBeNull();
  });

  it('增量拼接 delta.tool_calls（跨分片 name/arguments）', async () => {
    const svc = makeService();
    const res = makeFakeRes([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search_knowledge_base","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\":\\"食"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"堂几点关门\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const chunks = [];
    for await (const c of svc._parseStream(res, provider, { tools: [{ type: 'function' }] })) chunks.push(c);
    const done = chunks[chunks.length - 1];
    expect(done.done).toBe(true);
    expect(done.tool_calls).toHaveLength(1);
    expect(done.tool_calls[0].function.name).toBe('search_knowledge_base');
    expect(JSON.parse(done.tool_calls[0].function.arguments)).toEqual({ query: '食堂几点关门' });
  });

  it('多 index 工具调用按 index 排序', async () => {
    const svc = makeService();
    const res = makeFakeRes([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"b","function":{"name":"calculate","arguments":"{\\"expression\\":\\"2+2\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"search_knowledge_base","arguments":"{\\"query\\":\\"x\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const chunks = [];
    for await (const c of svc._parseStream(res, provider, { tools: [{}, {}] })) chunks.push(c);
    const tcs = chunks[chunks.length - 1].tool_calls;
    expect(tcs.map((t) => t.function.name)).toEqual(['search_knowledge_base', 'calculate']);
  });

  it('arguments 残缺（JSON 不完整）降级为空参数', async () => {
    const svc = makeService();
    const res = makeFakeRes([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"calculate","arguments":"{\\"expr"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const chunks = [];
    for await (const c of svc._parseStream(res, provider, { tools: [{}] })) chunks.push(c);
    const tcs = chunks[chunks.length - 1].tool_calls;
    expect(tcs).toHaveLength(1);
    expect(tcs[0].function.arguments).toBe('{}');
  });
});

describe('AiService._assembleToolCalls', () => {
  it('name 为空的调用被丢弃', () => {
    const svc = makeService();
    const map = new Map([
      [0, { id: 'x', name: '', arguments: '{}' }],
      [1, { id: 'y', name: 'calculate', arguments: '{"expression":"1+1"}' }],
    ]);
    const tcs = svc._assembleToolCalls(map, true, true);
    expect(tcs).toHaveLength(1);
    expect(tcs[0].function.name).toBe('calculate');
  });

  it('未启用 tools / 无调用时返回 null', () => {
    const svc = makeService();
    expect(svc._assembleToolCalls(new Map(), true, false)).toBeNull();
    expect(svc._assembleToolCalls(new Map(), false, true)).toBeNull();
  });
});

describe('AiService history compaction', () => {
  it('长对话压缩时保留 system 记忆消息', async () => {
    const svc = makeService();
    svc.judgeService = { summarize: async () => '早期摘要' };
    const history = [
      { role: 'system', content: '持久记忆上下文' },
      ...Array.from({ length: 14 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `消息${index}` })),
    ];
    const compacted = await svc._compactHistory(history);
    expect(compacted[0]).toEqual({ role: 'system', content: '持久记忆上下文' });
    expect(compacted.some(message => message.content.includes('早期摘要'))).toBe(true);
  });
});
