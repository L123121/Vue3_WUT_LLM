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
});
