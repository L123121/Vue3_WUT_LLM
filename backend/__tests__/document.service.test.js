import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = {
  hashes: new Map(),
  documentIds: new Set(),
  store: null,
};

function createStore() {
  return {
    hset: vi.fn(async (key, values) => {
      mocks.hashes.set(key, { ...(mocks.hashes.get(key) || {}), ...values });
      return 1;
    }),
    hgetall: vi.fn(async key => mocks.hashes.get(key) || null),
    sadd: vi.fn(async (_key, value) => {
      mocks.documentIds.add(value);
      return 1;
    }),
    smembers: vi.fn(async () => [...mocks.documentIds]),
    scard: vi.fn(async () => mocks.documentIds.size),
    pipeline: vi.fn(() => ({
      hgetall: vi.fn(),
      exec: vi.fn(async () => []),
    })),
  };
}

function getDocumentService() {
  delete require.cache[require.resolve('../src/services/document.service')];
  return require('../src/services/document.service');
}

describe('DocumentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hashes.clear();
    mocks.documentIds.clear();
    mocks.store = createStore();
  });

  it('仅在向量写入成功后标记 ready', async () => {
    const { DocumentService, VECTOR_STATUS } = getDocumentService();
    const indexingService = { indexDocument: vi.fn().mockResolvedValue(3) };
    const service = new DocumentService({ store: mocks.store, indexingService });

    const result = await service.addDocument({ title: '保研政策', content: '第一条\n\n第二条', category: '保研:保研政策' });
    const stored = mocks.hashes.get(`document:${result.id}`);

    expect(result.vectorStatus).toBe(VECTOR_STATUS.READY);
    expect(result.indexedChunkCount).toBe(3);
    expect(stored.vectorStatus).toBe(VECTOR_STATUS.READY);
    expect(stored.vectorMessage).toBe('已生成 3 个向量');
    expect(mocks.store.hset.mock.invocationCallOrder[0]).toBeLessThan(indexingService.indexDocument.mock.invocationCallOrder[0]);
  });

  it('向量写入失败时保留文档并标记 failed', async () => {
    const { DocumentService, VECTOR_STATUS } = getDocumentService();
    const indexingService = { indexDocument: vi.fn().mockRejectedValue(new Error('Qdrant not initialized')) };
    const service = new DocumentService({ store: mocks.store, indexingService });

    const result = await service.addDocument({ title: '保研政策', content: '政策内容', category: '保研:保研政策' });
    const stored = mocks.hashes.get(`document:${result.id}`);

    expect(result.vectorStatus).toBe(VECTOR_STATUS.FAILED);
    expect(result.vectorMessage).toBe('Qdrant not initialized');
    expect(stored.vectorStatus).toBe(VECTOR_STATUS.FAILED);
    expect(mocks.documentIds.has(result.id)).toBe(true);
  });

  it('未生成向量时不误报 ready', async () => {
    const { DocumentService, VECTOR_STATUS } = getDocumentService();
    const indexingService = { indexDocument: vi.fn().mockResolvedValue(0) };
    const service = new DocumentService({ store: mocks.store, indexingService });

    const result = await service.addDocument({ title: '空索引文档', content: '有效文本', category: 'general' });

    expect(result.vectorStatus).toBe(VECTOR_STATUS.FAILED);
    expect(result.vectorMessage).toBe('未生成可用向量');
  });
});
