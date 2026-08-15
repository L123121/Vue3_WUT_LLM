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
