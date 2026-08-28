import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/rag.service', () => ({
  RagService: class RagService {},
}));

vi.mock('../src/services/ai.service', () => ({
  aiService: {},
}));

vi.mock('../src/services/document.service', () => ({
  DocumentService: class DocumentService {},
}));

vi.mock('../src/services/memory-store', () => ({
  redis: {},
}));

vi.mock('../src/services/memory.service', () => ({
  MemoryService: class MemoryService {
    saveChatMemory() {}
  },
}));

vi.mock('../src/utils/response', () => ({
  successResponse: vi.fn(),
  errorResponse: vi.fn(),
}));

vi.mock('../src/services/file-upload.service', () => ({
  upload: { single: vi.fn(() => vi.fn()) },
  parseFile: vi.fn(),
  cleanupFile: vi.fn(),
}));

function getRagChatStream() {
  delete require.cache[require.resolve('../src/controllers/rag.controller')];
  return require('../src/controllers/rag.controller').ragChatStream;
}

describe('rag.controller ragChatStream', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('SSE 响应头发送失败时将原始错误交给 next', async () => {
    const expectedError = new Error('flush failed');
    const response = {
      headersSent: false,
      setHeader: vi.fn(),
      flushHeaders: vi.fn(() => { throw expectedError; }),
      removeListener: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    };
    const next = vi.fn();

    await getRagChatStream()(
      { body: { message: '请介绍学校图书馆', history: [] }, userId: 'u1', get: vi.fn() },
      response,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(expectedError);
    expect(response.write).not.toHaveBeenCalled();
  });
});

describe('rag.controller updateFeedbackEvalStatus', () => {
  // 原生 require 与控制器共享同一 CJS 模块图（vi.mock 不拦截 raw require），
  // 因此这里直接用真实 SQLite 存储跑集成断言，避免 mock 实例身份不一致
  function getHandlerAndStore() {
    delete require.cache[require.resolve('../src/controllers/rag.controller')];
    delete require.cache[require.resolve('../src/services/memory-store')];
    const handler = require('../src/controllers/rag.controller').updateFeedbackEvalStatus;
    const store = require('../src/services/memory-store').redis;
    return { handler, store };
  }

  const TEST_USER = 'eval_status_it_user';
  const TEST_ID = 'conv_it:msg_it';

  const makeRes = () => {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('非管理员返回 403', async () => {
    const { handler } = getHandlerAndStore();
    const res = makeRes();

    await handler({ userId: TEST_USER, body: { userId: TEST_USER, feedbackId: TEST_ID, status: 'queued' } }, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('状态非法或缺少标识返回 400', async () => {
    const { handler } = getHandlerAndStore();

    const resA = makeRes();
    await handler({ userId: 'admin', body: { userId: TEST_USER, feedbackId: TEST_ID, status: 'bad' } }, resA, vi.fn());
    expect(resA.status).toHaveBeenCalledWith(400);

    const resB = makeRes();
    await handler({ userId: 'admin', body: { status: 'queued' } }, resB, vi.fn());
    expect(resB.status).toHaveBeenCalledWith(400);
  });

  it('反馈不存在返回 404', async () => {
    const { handler } = getHandlerAndStore();
    const res = makeRes();

    await handler({ userId: 'admin', body: { userId: TEST_USER, feedbackId: 'missing:id', status: 'queued' } }, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('入队成功：evalStatus/evalStatusAt 落库且双写生效', async () => {
    const { handler, store } = getHandlerAndStore();
    await store.hset(`rag_feedback:${TEST_USER}`, TEST_ID, { id: TEST_ID, rating: 'dislike', question: '测试问题' });

    const res = makeRes();
    await handler({ userId: 'admin', body: { userId: TEST_USER, feedbackId: TEST_ID, status: 'queued' } }, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const saved = (await store.hgetall(`rag_feedback:${TEST_USER}`))[TEST_ID];
    expect(saved.evalStatus).toBe('queued');
    expect(saved.evalStatusAt).toEqual(expect.any(String));
    const allView = (await store.hgetall('rag_feedback:all'))[`${TEST_USER}:${TEST_ID}`];
    expect(allView.evalStatus).toBe('queued');
  });
});
