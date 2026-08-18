import { afterEach, describe, expect, it } from 'vitest';

const { createOperationalMetrics } = require('../src/services/operational-metrics.service');

const originalTtsCost = process.env.TTS_COST_CNY_PER_10K_CHARS;

describe('operational-metrics.service', () => {
  afterEach(() => {
    if (originalTtsCost === undefined) delete process.env.TTS_COST_CNY_PER_10K_CHARS;
    else process.env.TTS_COST_CNY_PER_10K_CHARS = originalTtsCost;
  });

  it('累计总量不会受最近样本上限影响', () => {
    process.env.TTS_COST_CNY_PER_10K_CHARS = '1';
    const metrics = createOperationalMetrics({ now: () => new Date(2026, 7, 18, 10).getTime() });

    for (let index = 0; index < 2105; index += 1) {
      metrics.recordTtsUsage({ model: 'tts-test', characters: 10 });
    }

    const snapshot = metrics.snapshot();
    expect(snapshot.tts.total).toBe(2105);
    expect(snapshot.tts.characters).toBe(21050);
    expect(snapshot.tts.recent).toHaveLength(100);
    expect(snapshot.daily.estimatedCostCny).toBeCloseTo(2.105);
  });

  it('跨自然日后重新计算当日成本', () => {
    process.env.TTS_COST_CNY_PER_10K_CHARS = '1';
    let timestamp = new Date(2026, 7, 18, 23, 59).getTime();
    const metrics = createOperationalMetrics({ now: () => timestamp });
    metrics.recordTtsUsage({ model: 'tts-test', characters: 10000 });

    timestamp = new Date(2026, 7, 19, 0, 1).getTime();
    metrics.recordTtsUsage({ model: 'tts-test', characters: 5000 });

    expect(metrics.snapshot().daily).toEqual({ date: '2026-08-19', estimatedCostCny: 0.5 });
    expect(metrics.snapshot().estimatedCostCny).toBe(1.5);
  });
});
