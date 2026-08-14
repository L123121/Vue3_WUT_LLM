import { describe, it, expect, vi, beforeEach } from 'vitest';

// 本文件测试文件后端（file）的 RRF/weighted 融合语义：
// config 默认已切 qdrant，若不锁定，vector-store.service.js 底部分发会导出 Qdrant 实现
process.env.VECTOR_STORE_BACKEND = 'file';

/**
 * RRF 融合单元测试 — 覆盖：
 * 1. RagService.fuseRetrievalResults 纯 RRF（rank-based，双通道命中 > 单通道命中）
 * 2. VectorStoreService.search RRF 融合（稠密/稀疏各自独立排名，score = Σ 1/(k+rank)）
 */
function getRagService() {
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/services/rag.service')];
  return require('../src/services/rag.service').RagService;
}

describe('RagService.fuseRetrievalResults RRF 融合', () => {
  let RagService;
  let rag;

  beforeEach(() => {
    vi.clearAllMocks();
    RagService = getRagService();
    rag = new RagService({ getCompletion: vi.fn() });
    rag.rrfK = 60;
  });

  // 构造：向量路命中 A(rank1)、B(rank2)，关键词路命中 B(rank1) → B 双通道
  const buildInputs = () => ({
    vector: [
      { id: 'doc-a_chunk_0', docId: 'doc-a', title: 'A', text: '语义相关内容', score: 0.9, chunkIndex: 0 },
      { id: 'doc-b_chunk_0', docId: 'doc-b', title: 'B', text: 'MPAcc 免修条件', score: 0.8, chunkIndex: 0 },
    ],
    keyword: [{ id: 'doc-b_chunk_0', docId: 'doc-b', title: 'B', text: 'MPAcc 免修条件', score: 0.9, _keywordScore: 1, chunkIndex: 0 }],
  });

  it('双通道命中项超过单通道 rank1 项，按 Σ 1/(k+rank) 排序', () => {
    const { vector, keyword } = buildInputs();
    const result = rag.fuseRetrievalResults(vector, keyword, 5);
    // B = 1/61(keyword rank1) + 1/62(vector rank2) > A = 1/61(vector rank1)
    expect(result[0].docId).toBe('doc-b');
    expect(result[1].docId).toBe('doc-a');
    expect(result[0].score).toBeCloseTo(1 / 61 + 1 / 62);
    expect(result[1].score).toBeCloseTo(1 / 61);
  });

  it('同一切片被多路召回时合并分数和通道', () => {
    const result = rag.fuseRetrievalResults(
      [{ id: 'doc-a_chunk_0', docId: 'doc-a', title: 'A', text: '内容', score: 0.8, chunkIndex: 0 }],
      [{ id: 'doc-a_chunk_0', docId: 'doc-a', title: 'A', text: '内容', score: 1, _keywordScore: 1, chunkIndex: 0 }],
      5
    );
    expect(result).toHaveLength(1);
    expect(result[0]._vectorScore).toBeCloseTo(0.8);
    expect(result[0]._keywordScore).toBeCloseTo(1);
    expect(result[0]._retrievalChannels).toEqual(['vector', 'keyword']);
    expect(result[0].score).toBeCloseTo(2 / 61);
  });
});

describe('VectorStoreService.search RRF 融合（显式 fusionMode=rrf）', () => {
  let VectorStoreService;
  let store;

  beforeEach(() => {
    vi.clearAllMocks();
    delete require.cache[require.resolve('../src/config')];
    delete require.cache[require.resolve('../src/services/vector-store.service')];
    VectorStoreService = require('../src/services/vector-store.service').VectorStoreService;
    vi.spyOn(VectorStoreService.prototype, '_load').mockImplementation(() => {});
    store = new VectorStoreService();
    store._docs = [];
    vi.spyOn(store, '_scheduleSave').mockImplementation(() => {});
    store._ready = true;
    store.fusionMode = 'rrf'; // RRF 语义测试显式指定（默认已切换为 weighted）
  });

  it('稠密/稀疏各自独立排名，双通道命中项排最前', async () => {
    store.addChunks(
      ['c1', 'c2'],
      [
        { dense: [1, 0, 0], sparse: {} },
        { dense: [0.1, 0.2, 0], sparse: { 200: 1 } },
      ],
      ['纯稠密命中', '双通道命中'],
      [{ docId: 'doc-a', title: 'A' }, { docId: 'doc-b', title: 'B' }]
    );
    // 查询同时命中 c2 的稀疏通道与 c1 的稠密通道
    const result = await store.search({ dense: [1, 0, 0], sparse: { 200: 1 } }, 10);
    // c2 = 1/61(sparse rank1) + 1/62(dense rank2) > c1 = 1/61(dense rank1)
    expect(result[0].id).toBe('c2');
    expect(result[1].id).toBe('c1');
    expect(result[0]._retrievalChannels).toEqual(['vector', 'sparse']);
    expect(result[1]._retrievalChannels).toEqual(['vector']);
    expect(result[0]._sparseScore).toBeCloseTo(1);
    expect(result[0].score).toBeCloseTo(1 / 61 + 1 / 62);
  });

  it('不传 embedding.sparse 时仅稠密通道计分', async () => {
    store.addChunks(
      ['c1', 'c2'],
      [[1, 0, 0], [0, 1, 0]],
      ['语义文档', '术语文档'],
      [{ docId: 'doc-a', title: 'A' }, { docId: 'doc-b', title: 'B' }]
    );
    const result = await store.search([1, 0, 0], 10);
    expect(result[0].id).toBe('c1');
    expect(result[0]._retrievalChannels).toEqual(['vector']);
    expect(result[0].score).toBeCloseTo(1 / 61);
  });

  it('兼容旧 4 参调用：额外 weights 参数被忽略，结果一致', async () => {
    store.addChunks(
      ['c1', 'c2'],
      [[1, 0, 0], [0, 1, 0]],
      ['语义文档', '术语文档'],
      [{ docId: 'doc-a', title: 'A' }, { docId: 'doc-b', title: 'B' }]
    );
    const legacy = await store.search([1, 0, 0], 10, null, { vector: 0.1, sparse: 0.9 });
    const plain = await store.search([1, 0, 0], 10);
    expect(legacy).toHaveLength(2);
    expect(legacy.map(item => item.id)).toEqual(plain.map(item => item.id));
    expect(legacy[0].score).toBe(plain[0].score);
  });
});

describe('VectorStoreService.search 默认融合模式（weighted）', () => {
  let VectorStoreService;
  let store;

  beforeEach(() => {
    vi.clearAllMocks();
    delete require.cache[require.resolve('../src/config')];
    delete require.cache[require.resolve('../src/services/vector-store.service')];
    VectorStoreService = require('../src/services/vector-store.service').VectorStoreService;
    vi.spyOn(VectorStoreService.prototype, '_load').mockImplementation(() => {});
    store = new VectorStoreService();
    store._docs = [];
    vi.spyOn(store, '_scheduleSave').mockImplementation(() => {});
    store._ready = true;
  });

  it('默认 weighted：分数 = 0.6·dense + 0.4·sparse', async () => {
    store.addChunks(
      ['c1', 'c2'],
      [
        { dense: [1, 0, 0], sparse: {} },
        { dense: [0, 1, 0], sparse: { 200: 1 } },
      ],
      ['纯稠密', '纯稀疏'],
      [{ docId: 'doc-a', title: 'A' }, { docId: 'doc-b', title: 'B' }]
    );
    // 查询稠密命中 c1、稀疏命中 c2：加权下两者分数量级相同
    const result = await store.search({ dense: [1, 0, 0], sparse: { 200: 1 } }, 10);
    expect(store.fusionMode).toBe('weighted'); // 默认即 weighted（config RAG_FUSION 缺省）
    expect(result[0]._hybridScore).toBeCloseTo(0.6 * 1 + 0.4 * 0);
    expect(result[0]._retrievalChannels).toEqual(['vector']);
  });
});
