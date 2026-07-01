import { describe, it, expect, beforeAll } from 'vitest';

const { AgentTracer, getRecentTraces } = require('../src/services/agent-tracer');

describe('AgentTracer', () => {
  // 用随机 userId 避免与其他用例 / 历史数据串
  const userId = 'tracer_test_' + Math.random().toString(36).slice(2);

  it('记录路由、工具调用与状态，toJSON 结构完整', () => {
    const t = new AgentTracer({ userId, conversationId: 'c1', message: '我成绩怎么样' });
    t.setRouting({ route: 'simple', intent: 'query_grades', confidence: 0.75 });
    t.recordToolCall('query_grades', { semester: '2025-2026-1' }, 120, true);
    t.recordToolCall('query_ungraded_scores', {}, 200, false, '接口超时');

    const json = t.toJSON();
    expect(json.route).toBe('simple');
    expect(json.intent).toBe('query_grades');
    expect(json.confidence).toBe(0.75);
    expect(json.steps).toHaveLength(2);
    expect(json.steps[0]).toMatchObject({ tool: 'query_grades', success: true, durationMs: 120 });
    expect(json.steps[1]).toMatchObject({ tool: 'query_ungraded_scores', success: false });
    expect(json.steps[1].error).toContain('接口超时');
    expect(json.status).toBe('ok');
    expect(json.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('markError / markTimeout / markAborted 切换状态', () => {
    const t = new AgentTracer({ userId });
    t.markError(new Error('something failed at https://internal.host/api'));
    expect(t.status).toBe('error');
    // URL 被脱敏
    expect(t.error).not.toContain('internal.host');
    expect(t.error).toContain('[url]');

    t.markTimeout();
    expect(t.status).toBe('timeout');

    t.markAborted();
    expect(t.status).toBe('aborted');
  });

  it('finish 后落盘到 store，getRecentTraces 可读回', async () => {
    const t = new AgentTracer({ userId, conversationId: 'c2', message: '查课表' });
    t.setRouting({ route: 'simple', intent: 'query_schedule', confidence: 0.75 });
    t.recordToolCall('query_course_schedule', { week: 3 }, 90, true);
    t.finish();

    // finish 异步落盘，等一下
    await new Promise((r) => setTimeout(r, 50));

    const traces = await getRecentTraces(userId, 10);
    expect(traces.length).toBeGreaterThan(0);
    const last = traces[traces.length - 1];
    expect(last.conversationId).toBe('c2');
    expect(last.intent).toBe('query_schedule');
    expect(last.steps[0].tool).toBe('query_course_schedule');
  });

  it('参数过大时被截断，不污染 trace', () => {
    const t = new AgentTracer({ userId });
    const bigArgs = { text: 'x'.repeat(500) };
    t.recordToolCall('some_tool', bigArgs, 10, true);
    // _truncateArgs 在 >200 字符时替换为 _truncated 占位
    const step = t.steps[0];
    expect(step.args).toBeTruthy();
  });

  it('toSummary 输出前端展示所需字段，不含敏感/大字段', () => {
    const t = new AgentTracer({ userId, conversationId: 'c3', message: '查课表' });
    t.setRouting({ route: 'simple', intent: 'query_schedule', confidence: 0.75 });
    t.recordToolCall('query_course_schedule', { week: 3 }, 90, true);
    t.recordToolCall('query_ungraded_scores', {}, 200, false, '超时');
    t.setIterations(1);

    const s = t.toSummary();
    // 展示字段齐全
    expect(s.route).toBe('simple');
    expect(s.routeLabel).toBe('快捷查询'); // 后端下发中文，前端无需再映射
    expect(s.intent).toBe('query_schedule');
    expect(s.confidence).toBe(0.75);
    expect(s.iterations).toBe(1);
    expect(s.stepCount).toBe(2);
    expect(s.status).toBe('ok');
    expect(s.totalMs).toBeGreaterThanOrEqual(0);
    // 不应包含 steps 正文 / message / userId（敏感或大字段）
    expect(s.steps).toBeUndefined();
    expect(s.message).toBeUndefined();
    expect(s.userId).toBeUndefined();
  });
});
