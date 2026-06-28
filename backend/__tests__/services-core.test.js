import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';

// 真实的 config 加载 .env，所以需要用不同的方式 mock
// 我们直接 set env
const ORIG_ENV = process.env;

describe('AiService', () => {
  let AiService;

  beforeAll(() => {
    // Do NOT mock config — use real config, but set env vars before importing
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_API_KEY = 'test-key';
    process.env.AI_BASE_URL = 'https://test-api.example.com/v2';
    process.env.AI_MODEL = 'test-model';
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  function getAiService() {
    delete require.cache[require.resolve('../src/services/ai.service')];
    delete require.cache[require.resolve('../src/config')];
    return require('../src/services/ai.service').AiService;
  }

  it('正常构造', () => {
    const Ai = getAiService();
    const ai = new Ai();
    expect(ai.apiKey).toBe('test-key');
    expect(ai.model).toBe('test-model');
  });

  it('无 API Key 返回 mock', async () => {
    process.env.AI_API_KEY = '';
    const Ai = getAiService();
    const ai = new Ai();
    const r = await ai.getCompletion('你好');
    expect(r.isMock).toBe(true);
    expect(r.content).toContain('AI 服务暂时不可用');
  });

  it('buildMessages', () => {
    const Ai = getAiService();
    const msgs = new Ai()._buildMessages('你好', [
      { role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' },
    ]);
    expect(msgs).toHaveLength(3);
    expect(msgs[2].content).toBe('你好');
  });

  it('buildPayload', () => {
    const Ai = getAiService();
    const p = new Ai()._buildPayload('hello', [], false);
    expect(p.model).toBe('test-model');
    expect(p.stream).toBe(false);
  });

  it('Anthropic 模式检测', () => {
    process.env.AI_BASE_URL = 'https://api.anthropic.com/anthropic/v1';
    const Ai = getAiService();
    expect(new Ai().anthropicMode).toBe(true);
  });

  it('_buildHeaders OpenAI', () => {
    const Ai = getAiService();
    const h = new Ai()._buildHeaders('/v2/chat/completions');
    expect(h['Authorization']).toBe('Bearer test-key');
  });

  it('mock 流式响应', async () => {
    process.env.AI_API_KEY = '';
    const Ai = getAiService();
    const ai = new Ai();
    const chunks = [];
    for await (const c of ai.getCompletionStream('你好')) {
      chunks.push(c);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[chunks.length - 1].done).toBe(true);
  });
});

describe('TextSplitter', () => {
  let TextSplitter;

  beforeEach(() => {
    delete require.cache[require.resolve('../src/utils/text-splitter')];
    TextSplitter = require('../src/utils/text-splitter').TextSplitter;
  });

  it('空文本返回空数组', () => {
    const s = new TextSplitter();
    expect(s.splitByParagraph('')).toEqual([]);
    expect(s.splitByParagraph(null)).toEqual([]);
  });

  it('按段落分割：短段合并到同一 chunk，chunkSize 限制分割', () => {
    const s = new TextSplitter({ chunkSize: 30 });
    const text = 'A\n\nB\n\nC';
    const chunks = s.splitByParagraph(text);
    // A+B+C 总长 < 30，合并在一个 chunk 里
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe('A\n\nB\n\nC');
  });

  it('按段落分割：超出 chunkSize 触发分段', () => {
    const s = new TextSplitter({ chunkSize: 10 });
    const text = 'AAAAAAAAAA\n\nBBBBBBBBBB\n\nCCCCCCCCCC';  // 各10字符
    const chunks = s.splitByParagraph(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('长段落按句子分割（chunkSize 较小）', () => {
    const s = new TextSplitter({ chunkSize: 15 });
    const chunks = s.splitByParagraph('这是第一句话。这是第二句话。这是第三句话。');
    // chunkSize=15 会触发句子级别的分割
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('强制分割超长文本', () => {
    const s = new TextSplitter({ chunkSize: 10, chunkOverlap: 2 });
    const chunks = s.forceSplit('12345678901234567890');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].length).toBeLessThanOrEqual(10);
  });

  it('默认配置', () => {
    const s = new TextSplitter();
    expect(s.chunkSize).toBe(500);
    expect(s.chunkOverlap).toBe(50);
  });
});

describe('ChatService', () => {
  let ChatService;

  beforeEach(() => {
    delete require.cache[require.resolve('../src/services/chat.service')];
    ChatService = require('../src/services/chat.service').ChatService;
  });

  it('调用 AiService 并返回格式化结果', async () => {
    const mockAi = { getCompletion: vi.fn().mockResolvedValue({ content: '回复', isMock: false }) };
    const svc = new ChatService(mockAi);
    const r = await svc.getResponse('你好', []);
    expect(mockAi.getCompletion).toHaveBeenCalledWith('你好', []);
    expect(r.reply).toBe('回复');
    expect(r.timestamp).toBeInstanceOf(Date);
    expect(r.isMock).toBe(false);
  });

  it('处理错误', async () => {
    const mockAi = { getCompletion: vi.fn().mockRejectedValue(new Error('网络')) };
    const svc = new ChatService(mockAi);
    const r = await svc.getResponse('你好');
    expect(r.isMock).toBe(true);
    expect(r.reply).toContain('抱歉');
    expect(r.error).toBe('网络');
  });
});

