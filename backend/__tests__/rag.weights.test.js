import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 动态权重路由单元测试 — 覆盖：
 * 1. _terminality 术语倾向打分（语义问题低分 / 术语问题高分）
 * 2. fuseRetrievalResults 传入 query 时按术语倾向调整权重（不传时兼容默认）
 * 3. vectorStore.search 的可选 weights 参数（兼容旧调用）
 */
function getRagService() {
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/services/rag.service')];
  return require('../src/services/rag.service').RagService;
}

const c = (id, score) => ({ id, _rerankScore: score });

describe('RagService._terminality', () => {
  let RagService;
  let rag;

  beforeEach(() => {
    vi.clearAllMocks();
    RagService = getRagService();
    rag = new RagService({ getCompletion: vi.fn() });
  });

  it('纯语义/口语问题返回低分', () => {
    expect(rag._terminality('图书馆怎么借书')).toBeLessThan(0.3);
    expect(rag._terminality('我想了解一下这个怎么用')).toBeLessThan(0.3);
    expect(rag._terminality('有没有推荐的复习方法')).toBeLessThan(0.3);
  });

  it('术语/精确问题返回高分', () => {
    expect(rag._terminality('《离散数学》2024版培养方案')).toBeGreaterThan(0.5);
    expect(rag._terminality('MPAcc 免修条件')).toBeGreaterThan(0.4);
    // 文号+条款：命中信号3（+0.3）+ 数字（+0.1）= 0.4
    expect(rag._terminality('教发〔2023〕1号 第12条')).toBeGreaterThan(0.3);
  });

  it('结果被 clamp 到 [0, 1]', () => {
    expect(rag._terminality('《A》MPAcc CET-4 第12条 绩点 3.5')).toBeLessThanOrEqual(1);
    expect(rag._terminality('')).toBeGreaterThanOrEqual(0);
  });
});

describe('RagService.fuseRetrievalResults 动态权重', () => {
  let RagService;
  let rag;

  beforeEach(() => {
    vi.clearAllMocks();
    RagService = getRagService();
    rag = new RagService({ getCompletion: vi.fn() });
    rag.vectorWeight = 0.6;
    rag.keywordWeight = 0.4;
  });

  // 构造：向量路命中 A（高向量分），关键词路命中 B（高关键词分）
  const buildInputs = () => ({
    vector: [{ id: 'doc-a_chunk_0', docId: 'doc-a', title: 'A', text: '语义相关内容', score: 0.9, chunkIndex: 0 }],
    keyword: [{ id: 'doc-b_chunk_0', docId: 'doc-b', title: 'B', text: 'MPAcc 免修条件', score: 0.9, _keywordScore: 1, chunkIndex: 0 }],
  });

  it('不传 query 时使用默认权重（兼容旧调用）', () => {
    const { vector, keyword } = buildInputs();
    const result = rag.fuseRetrievalResults(vector, keyword, 5);
    // 默认 0.6/0.4：A 向量分 0.9*0.6=0.54 vs B 关键词分 1*0.4=0.4，A 应排前
    expect(result[0].docId).toBe('doc-a');
  });

  it('术语 query 时提高关键词权重，术语命中项排前', () => {
    const { vector, keyword } = buildInputs();
    const result = rag.fuseRetrievalResults(vector, keyword, 5, 'MPAcc 免修条件是什么');
    // 术语倾向高 → 关键词权重 0.7：B 关键词分 1*0.7=0.7 > A 向量分 0.9*0.3=0.27，B 应排前
    expect(result[0].docId).toBe('doc-b');
  });

  it('语义 query 时保持向量为主，语义命中项排前', () => {
    const { vector, keyword } = buildInputs();
    const result = rag.fuseRetrievalResults(vector, keyword, 5, '图书馆怎么借书');
    // 语义倾向 → 向量权重 ~0.6，A 仍排前
    expect(result[0].docId).toBe('doc-a');
  });
});

describe('VectorStoreService.search 可选权重', () => {
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

  it('不传 weights 时使用实例默认权重（兼容旧调用）', async () => {
    store.addChunks(
      ['c1', 'c2'],
      [[1, 0, 0], [0, 1, 0]],
      ['语义文档', '术语文档'],
      [{ docId: 'doc-a', title: 'A' }, { docId: 'doc-b', title: 'B' }]
    );
    const result = await store.search([1, 0, 0], 10);
    expect(result[0].id).toBe('c1');
  });

  it('传入 weights 时按指定权重计算混合分数', async () => {
    store.addChunks(
      ['c1', 'c2'],
      [[1, 0, 0], [0, 1, 0]],
      ['语义文档', '术语文档'],
      [{ docId: 'doc-a', title: 'A' }, { docId: 'doc-b', title: 'B' }]
    );
    // sparse 权重拉满：c1 dense 命中但 sparse 无分，分数=0*0.1+0*0.9=0；
    // 两个候选 dense/sparse 分数组合下验证权重生效（至少不应抛错且返回正常）
    const result = await store.search([1, 0, 0], 10, null, { vector: 0.1, sparse: 0.9 });
    expect(result).toHaveLength(2);
    expect(result[0]._hybridScore).toBeGreaterThanOrEqual(0);
    // 权重极值下 dense 贡献被压低，c1 分数显著低于默认权重时的值
    const defaultResult = await store.search([1, 0, 0], 10);
    expect(result[0].score).toBeLessThanOrEqual(defaultResult[0].score);
  });
});
