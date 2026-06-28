import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ToolRegistry', () => {
  let ToolRegistry, TOOL_SOURCES;

  beforeEach(() => {
    vi.clearAllMocks();
    delete require.cache[require.resolve('../src/services/tool-registry.service')];
    const mod = require('../src/services/tool-registry.service');
    ToolRegistry = mod.ToolRegistry;
    TOOL_SOURCES = mod.TOOL_SOURCES;
  });

  function createRegistry() {
    return new ToolRegistry();
  }

  it('注册有效工具', () => {
    const r = createRegistry();
    r.register({ name: 'test_tool', description: '测试', handler: async () => 'ok' });
    expect(r.getTool('test_tool').name).toBe('test_tool');
    expect(r.getTool('test_tool').enabled).toBe(true);
  });

  it('缺少 name 或 handler 抛出异常', () => {
    const r = createRegistry();
    expect(() => r.register({ handler: async () => {} })).toThrow();
    expect(() => r.register({ name: 'nope' })).toThrow();
  });

  it('注册默认值', () => {
    const r = createRegistry();
    r.register({ name: 'min', handler: async () => {} });
    const t = r.getTool('min');
    expect(t.description).toBe('');
    expect(t.category).toBe('general');
    expect(t.source).toBe(TOOL_SOURCES.CUSTOM);
  });

  it('unregister 移除工具', () => {
    const r = createRegistry();
    r.register({ name: 'tmp', handler: async () => {} });
    expect(r.unregister('tmp')).toBe(true);
    expect(r.getTool('tmp')).toBeNull();
  });

  it('unregister 不存在返回 false', () => {
    expect(createRegistry().unregister('xx')).toBe(false);
  });

  it('setEnabled 控制状态', () => {
    const r = createRegistry();
    r.register({ name: 't', handler: async () => {} });
    r.setEnabled('t', false);
    expect(r.getTool('t').enabled).toBe(false);
    expect(r.getEnabledTools()).toHaveLength(0);
    r.setEnabled('t', true);
    expect(r.getEnabledTools()).toHaveLength(1);
  });

  it('按来源和分类过滤', () => {
    const r = createRegistry();
    r.register({ name: 'a', handler: async () => {}, source: TOOL_SOURCES.BUILTIN, category: 'c1' });
    r.register({ name: 'b', handler: async () => {}, source: TOOL_SOURCES.SCHOOL, category: 'c1' });
    r.register({ name: 'c', handler: async () => {}, source: TOOL_SOURCES.CUSTOM, category: 'c2' });
    r.register({ name: 'd', handler: async () => {}, enabled: false, category: 'c2' });

    expect(r.getAllTools()).toHaveLength(4);
    expect(r.getEnabledTools()).toHaveLength(3);
    expect(r.getToolsBySource(TOOL_SOURCES.BUILTIN)).toHaveLength(1);
    expect(r.getToolsByCategory('c1')).toHaveLength(2);
    expect(r.getCategories()).toEqual(expect.arrayContaining(['c1', 'c2']));
  });

  it('getToolSchemas 返回 LLM 格式', () => {
    const r = createRegistry();
    r.register({ name: 'fn1', description: 'desc', handler: async () => {}, parameters: { type: 'object', properties: {} } });
    const schemas = r.getToolSchemas();
    expect(schemas[0].type).toBe('function');
    expect(schemas[0].function.name).toBe('fn1');
  });

  it('getToolNames 返回启用工具名称', () => {
    const r = createRegistry();
    r.register({ name: 'a', handler: async () => {} });
    r.register({ name: 'b', handler: async () => {}, enabled: false });
    const names = r.getToolNames();
    expect(names).toContain('a');
    expect(names).not.toContain('b');
  });

  it('执行工具', async () => {
    const r = createRegistry();
    r.register({ name: 'echo', handler: async (a) => a.msg });
    expect(await r.executeTool('echo', { msg: 'hi' })).toBe('hi');
  });

  it('执行不存在的工具返回错误信息', async () => {
    expect(await createRegistry().executeTool('x', {})).toContain('未知工具');
  });

  it('执行禁用的工具返回禁用信息', async () => {
    const r = createRegistry();
    r.register({ name: 'off', handler: async () => 'ok' });
    r.setEnabled('off', false);
    expect(await r.executeTool('off', {})).toContain('已禁用');
  });

  it('执行异常的工具返回错误信息', async () => {
    const r = createRegistry();
    r.register({ name: 'brk', handler: async () => { throw new Error('崩溃'); } });
    expect(await r.executeTool('brk', {})).toContain('执行失败');
  });

  it('传递上下文', async () => {
    const handler = vi.fn(async (a, ctx) => ctx.uid);
    const r = createRegistry();
    r.register({ name: 'ctx', handler });
    await r.executeTool('ctx', {}, { uid: 'u1' });
    expect(handler).toHaveBeenCalledWith({}, { uid: 'u1' });
  });

  it('getStats 统计', () => {
    const r = createRegistry();
    r.register({ name: 't1', handler: async () => {}, source: TOOL_SOURCES.BUILTIN });
    const stats = r.getStats();
    expect(stats.total).toBe(1);
    expect(stats.enabled).toBe(1);
    expect(stats.bySource.builtin).toBe(1);
  });
});
