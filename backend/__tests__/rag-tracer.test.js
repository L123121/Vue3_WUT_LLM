import { describe, it, expect } from 'vitest';

const { RagTracer, getRecentRagTraces } = require('../src/services/rag-tracer.service');

describe('RagTracer', () => {
  const userId = 'rag_tracer_test_' + Math.random().toString(36).slice(2);

  it('记录阶段耗时、状态和前端摘要', () => {
    const tracer = new RagTracer({ userId, traceId: 'trace-test-1', message: '查询校训' });

    tracer.recordStage('embedding', 120, true, { model: 'bge-small-zh' });
    tracer.recordStage('milvus_search', 45, false, { topK: 50 }, new Error('milvus timeout'));
    tracer.setRetrieval({ vector: { count: 0, latency: 45 }, fused: { count: 0 } });
    tracer.markError(new Error('request failed'));

    const summary = tracer.toSummary();
    expect(summary.traceId).toBe('trace-test-1');
    expect(summary.timings).toHaveLength(2);
    expect(summary.failedStageCount).toBe(1);
    expect(summary.failedStages[0].name).toBe('milvus_search');
    expect(summary.userId).toBeUndefined();
    expect(summary.message).toBeUndefined();
  });

  it('finish 后可读取最近 RAG trace', async () => {
    const tracer = new RagTracer({ userId, traceId: 'trace-test-2', message: '查询校区' });
    tracer.recordStage('embedding', 10, true);
    tracer.finish({ usedRag: true, matchedDocs: 1 });

    await new Promise(resolve => setTimeout(resolve, 50));

    const traces = await getRecentRagTraces(userId, 5);
    expect(traces.length).toBeGreaterThan(0);
    expect(traces[traces.length - 1].traceId).toBe('trace-test-2');
    expect(traces[traces.length - 1].outcome.usedRag).toBe(true);
  });
});
