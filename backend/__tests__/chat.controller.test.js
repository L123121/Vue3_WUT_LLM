import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/conversation-orchestrator.service', () => ({
  ConversationOrchestrator: class ConversationOrchestrator {
    async *chatStream() {}
  },
}));

function getStreamHandler() {
  delete require.cache[require.resolve('../src/controllers/chat.controller')];
  return require('../src/controllers/chat.controller').streamHandler;
}

function getWriteStreamEvent() {
  delete require.cache[require.resolve('../src/controllers/chat.controller')];
  return require('../src/controllers/chat.controller').writeStreamEvent;
}

describe('chat.controller streamHandler', () => {
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

    await getStreamHandler()(
      { body: { message: '请介绍学校图书馆', history: [] }, userId: 'u1' },
      response,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(expectedError);
    expect(response.write).not.toHaveBeenCalled();
  });

  it('将 Agentic RAG trace 映射为独立 SSE 字段', () => {
    const response = { write: vi.fn() };

    getWriteStreamEvent()(response, {
      type: 'trace',
      channel: 'agentic_rag',
      trace: {
        traceId: 'agentic-1',
        rounds: 2,
        queries: ['原问题', '改写问题'],
        matchedDocs: 3,
        finishReason: 'evidence_found',
      },
    }, 'fallback-trace');

    const payload = JSON.parse(response.write.mock.calls[0][0].slice(6));
    expect(payload.traceId).toBe('agentic-1');
    expect(payload.agenticRag).toEqual(expect.objectContaining({
      rounds: 2,
      queries: ['原问题', '改写问题'],
      matchedDocs: 3,
      finishReason: 'evidence_found',
    }));
  });
});
