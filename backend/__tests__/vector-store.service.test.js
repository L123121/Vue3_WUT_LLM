import { describe, it, expect, vi, beforeEach } from 'vitest';

// 本测试针对文件持久化实现（VECTOR_STORE_BACKEND=file）：
// config 默认已切 qdrant，若不锁定，vector-store.service.js 底部分发会导出 Qdrant 实现
process.env.VECTOR_STORE_BACKEND = 'file';

/**
 * VectorStoreService 单元测试 — 文件持久化 + 精确相似度检索
 * 覆盖 addChunks / search（排序、过滤、空 embedding）/ deleteByDocId / count。
 */
function getVectorStore() {
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/services/vector-store.service')];
  return require('../src/services/vector-store.service').VectorStoreService;
}

describe('VectorStoreService', () => {
  let VectorStoreService;
  let store;

  beforeEach(() => {
    vi.clearAllMocks();
    VectorStoreService = getVectorStore();
    // 避免构造函数 _load() 读取真实 data/vectors.json（4067 条），保证隔离与速度
    vi.spyOn(VectorStoreService.prototype, '_load').mockImplementation(() => {});
    store = new VectorStoreService();
    // 清空可能残留的向量，保证测试隔离
    store._docs = [];
    // 避免 2s 定时器把测试数据写回真实 vectors.json
    vi.spyOn(store, '_scheduleSave').mockImplementation(() => {});
    // 跳过 ensureReady 的文件重建逻辑，直接进入就绪态
    store._ready = true;
  }, 30000);

  it('addChunks 后 count 正确', async () => {
    store.addChunks(
      ['c1', 'c2'],
      [[1, 0, 0], [0, 1, 0]],
      ['文档一', '文档二'],
      [{ docId: 'doc-a', title: 'A' }, { docId: 'doc-b', title: 'B' }]
    );
    expect(await store.count()).toBe(2);
    expect(store._docs[0].metadata.parentId).toBe('doc-a'); // parentId 默认回退 docId
  });

  it('search 按混合分数降序返回 topK，且带元信息字段', async () => {
    store.addChunks(
      ['c1', 'c2'],
      [[1, 0, 0], [0, 1, 0]],
      ['学生证补办', '图书馆开放'],
      [{ docId: 'doc-a', title: '学生证', chunkIndex: 0 }, { docId: 'doc-b', title: '图书馆', chunkIndex: 0 }]
    );
    const result = await store.search([1, 0, 0], 10);
    expect(result).toHaveLength(2);
    // 与查询向量完全一致 → cosine=1，排第一
    expect(result[0].id).toBe('c1');
    expect(result[0].docId).toBe('doc-a');
    expect(result[0].text).toBe('学生证补办');
    expect(result[0]._hybridScore).toBeGreaterThan(0);
    // RRF：查询无 sparse 向量 → 仅稠密通道贡献，c2 无任何命中分
    expect(result[0]._retrievalChannels).toEqual(['vector']);
  });

  it('search 支持 metadata 过滤', async () => {
    store.addChunks(
      ['c1', 'c2'],
      [[1, 0, 0], [1, 0, 0]],
      ['内容A', '内容B'],
      [{ docId: 'doc-a', category: '教务' }, { docId: 'doc-b', category: '图书馆' }]
    );
    const result = await store.search([1, 0, 0], 10, { category: '教务' });
    expect(result).toHaveLength(1);
    expect(result[0].docId).toBe('doc-a');
  });

  it('search 空 embedding 返回空数组', async () => {
    expect(await store.search(null, 10)).toEqual([]);
    expect(await store.search([], 10)).toEqual([]);
  });

  it('deleteByDocId 删除该文档所有 chunk', async () => {
    store.addChunks(
      ['c1', 'c2', 'c3'],
      [[1, 0, 0], [1, 0, 0], [1, 0, 0]],
      ['a', 'b', 'c'],
      [{ docId: 'doc-a' }, { docId: 'doc-a' }, { docId: 'doc-b' }]
    );
    await store.deleteByDocId('doc-a');
    expect(await store.count()).toBe(1);
    expect(store._docs[0].id).toBe('c3');
  });
});
