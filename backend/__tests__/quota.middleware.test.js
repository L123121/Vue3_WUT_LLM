import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * quota.middleware 单元测试 — 用户级每日配额
 * 覆盖：白名单跳过 / 配额不足 429 / 充足放行 + 成功后递增 / 非 2xx 不递增 / fail-open。
 *
 * quota.service 导出单例对象（module.exports = new QuotaService()），
 * middleware 与其引用同一实例，因此直接 vi.spyOn 单例方法即可隔离。
 */
function getQuotaMiddleware() {
  delete require.cache[require.resolve('../src/middleware/quota.middleware')];
  return require('../src/middleware/quota.middleware').quotaMiddleware;
}

const flush = () => new Promise((r) => setImmediate(r));

describe('quota.middleware', () => {
  let quotaMiddleware;
  let quotaService;

  beforeEach(() => {
    vi.restoreAllMocks();
    quotaService = require('../src/services/quota.service');
    quotaMiddleware = getQuotaMiddleware();
  });

  it('白名单路径（/api/health）跳过配额检查', () => {
    const checkSpy = vi.spyOn(quotaService, 'check');
    const req = { path: '/api/health', userId: null };
    const next = vi.fn();
    quotaMiddleware(req, {}, next);
    expect(checkSpy).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('API 列表页精确跳过，但 /api/chat 等消耗 LLM 的接口不跳过', () => {
    const checkSpy = vi.spyOn(quotaService, 'check');
    // /api 列表页本身跳过
    const reqList = { path: '/api', userId: null };
    quotaMiddleware(reqList, {}, vi.fn());
    expect(checkSpy).not.toHaveBeenCalled();
    // /api/chat 必须走配额检查（此前 "/api" 前缀误匹配导致配额失效）
    const reqChat = { path: '/api/chat', userId: 'u1' };
    checkSpy.mockResolvedValue({ ok: true, usage: { used: 1, limit: 100 } });
    quotaMiddleware(reqChat, { on: vi.fn(), statusCode: 200 }, vi.fn());
    expect(checkSpy).toHaveBeenCalledWith('u1');
  });

  it('静态资源路径跳过配额检查', () => {
    const checkSpy = vi.spyOn(quotaService, 'check');
    const req = { path: '/assets/app.js', userId: null };
    const next = vi.fn();
    quotaMiddleware(req, {}, next);
    expect(checkSpy).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('配额不足时返回 429 且不继续', async () => {
    const checkSpy = vi.spyOn(quotaService, 'check').mockResolvedValue({ ok: false, usage: { used: 100, limit: 100 } });
    const req = { path: '/api/chat', userId: 'u1' };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), on: vi.fn() };
    const next = vi.fn();

    quotaMiddleware(req, res, next);
    await flush();

    expect(checkSpy).toHaveBeenCalledWith('u1');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: '今日配额已用完，请明天再试' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('配额充足时放行，成功响应（2xx）后递增配额', async () => {
    const checkSpy = vi.spyOn(quotaService, 'check').mockResolvedValue({ ok: true, usage: { used: 5, limit: 100 } });
    const incrementSpy = vi.spyOn(quotaService, 'incrementIfAllowed').mockReturnValue({ ok: true, usage: { used: 6, limit: 100 } });
    const req = { path: '/api/chat', userId: 'u1' };
    let finishCb;
    const res = {
      statusCode: 200,
      on: vi.fn((evt, cb) => { if (evt === 'finish') finishCb = cb; }),
    };
    const next = vi.fn();

    quotaMiddleware(req, res, next);
    await flush();

    expect(checkSpy).toHaveBeenCalledWith('u1');
    expect(next).toHaveBeenCalled();
    expect(incrementSpy).not.toHaveBeenCalled(); // 响应未结束前不递增
    finishCb();
    expect(incrementSpy).toHaveBeenCalledWith('u1');
  });

  it('非 2xx 响应不递增配额', async () => {
    vi.spyOn(quotaService, 'check').mockResolvedValue({ ok: true, usage: { used: 5, limit: 100 } });
    const incrementSpy = vi.spyOn(quotaService, 'incrementIfAllowed').mockReturnValue({ ok: true, usage: { used: 6, limit: 100 } });
    const req = { path: '/api/chat', userId: 'u1' };
    let finishCb;
    const res = {
      statusCode: 500,
      on: vi.fn((evt, cb) => { if (evt === 'finish') finishCb = cb; }),
    };
    const next = vi.fn();

    quotaMiddleware(req, res, next);
    await flush();
    finishCb();

    expect(incrementSpy).not.toHaveBeenCalled();
  });

  it('配额系统异常时不阻塞请求（fail-open）', async () => {
    vi.spyOn(quotaService, 'check').mockRejectedValue(new Error('store down'));
    const req = { path: '/api/chat', userId: 'u1' };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), on: vi.fn() };
    const next = vi.fn();

    quotaMiddleware(req, res, next);
    await flush();

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
