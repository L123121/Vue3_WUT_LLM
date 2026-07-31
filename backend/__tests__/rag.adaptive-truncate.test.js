import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 自适应截断单元测试 — 覆盖 _adaptiveTruncate 的
 * 断崖检测 / 动态低分过滤 / 硬上限 / 单结果放宽 四条规则。
 */
function getRagService() {
  delete require.cache[require.resolve('../src/services/rag.service')];
  return require('../src/services/rag.service').RagService;
}

// 构造带 _rerankScore 的候选
const c = (id, score) => ({ id, _rerankScore: score });

describe('RagService._adaptiveTruncate', () => {
  let RagService;
  let rag;

  beforeEach(() => {
    vi.clearAllMocks();
    RagService = getRagService();
    rag = new RagService({ getCompletion: vi.fn() });
  });

  it('空数组返回空，单候选原样返回', () => {
    expect(rag._adaptiveTruncate([], 10)).toEqual([]);
    const single = [c('a', 0.9)];
    expect(rag._adaptiveTruncate(single, 10)).toEqual(single);
  });

  it('断崖检测：分差 > 0.05 处截断，保留断崖前全部', () => {
    // 0.90 → 0.42 分差 0.48 > 0.05，断崖在 index 2
    const candidates = [c('a', 0.95), c('b', 0.90), c('c', 0.42), c('d', 0.40), c('e', 0.38)];
    const result = rag._adaptiveTruncate(candidates, 10);
    expect(result.map(x => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('低分过滤：低于动态 minScore 的候选被严格排除', () => {
    // 断崖在 index 3（0.62→0.20 分差 0.42），低分也在 index 3（0.20 < 0.30）
    // 低分过滤优先：0.20 / 0.10 都应被排除，而不是保留断崖后的第一个
    const candidates = [c('a', 0.70), c('b', 0.66), c('c', 0.62), c('d', 0.20), c('e', 0.10)];
    const result = rag._adaptiveTruncate(candidates, 10);
    expect(result.map(x => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('硬上限：结果数量不超过 effectiveMaxCount', () => {
    // 分数都够高、无断崖，但 maxCount=2
    const candidates = [c('a', 0.95), c('b', 0.90), c('c', 0.85), c('d', 0.80)];
    const result = rag._adaptiveTruncate(candidates, 2);
    expect(result).toHaveLength(2);
    expect(result.map(x => x.id)).toEqual(['a', 'b']);
  });

  it('单结果放宽：只剩 1 个且第 2 个分数够高时补充到 2 个', () => {
    // effectiveMaxCount=1 → 初始 1 个；sorted[1]=0.85 > dynamicMinScore=0.25 → 补充
    const candidates = [c('a', 0.90), c('b', 0.85), c('c', 0.10)];
    const result = rag._adaptiveTruncate(candidates, 1);
    expect(result.map(x => x.id)).toEqual(['a', 'b']);
  });

  it('未排序输入也会按 rerank 分数降序后截断', () => {
    const candidates = [c('x', 0.40), c('y', 0.95), c('z', 0.60)];
    const result = rag._adaptiveTruncate(candidates, 10);
    expect(result.map(x => x.id)).toEqual(['y', 'z']);
  });

  it('query 类型配置会覆盖 maxCount（rerankTopK）', () => {
    vi.spyOn(rag, 'getTypeConfig').mockReturnValue({
      type: 'general',
      rerankTopK: 3,
      minScore: 0.5,
      clamp: [0.4, 0.6],
    });
    const candidates = [c('a', 0.95), c('b', 0.90), c('c', 0.85), c('d', 0.80)];
    const result = rag._adaptiveTruncate(candidates, 10, '某类问题');
    // rerankTopK=3 覆盖 maxCount=10
    expect(result).toHaveLength(3);
    expect(rag.getTypeConfig).toHaveBeenCalledWith('某类问题');
  });
});
