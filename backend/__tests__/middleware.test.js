import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('auth.middleware', () => {
  let authMiddleware, requireAuth, generateToken;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests';
    delete require.cache[require.resolve('../src/config')];
    delete require.cache[require.resolve('../src/middleware/auth.middleware')];
    const mod = require('../src/middleware/auth.middleware');
    authMiddleware = mod.authMiddleware;
    requireAuth = mod.requireAuth;
    generateToken = mod.generateToken;
  });

  it('无 cookie 时设置 userId 为 null', () => {
    const req = { cookies: {} };
    const res = { clearCookie: vi.fn() };
    const next = vi.fn();
    authMiddleware(req, res, next);
    expect(req.userId).toBeNull();
    expect(next).toHaveBeenCalled();
  });

  it('有效 cookie 设置 userId', () => {
    const token = generateToken({ userId: 'u123', username: 'test' });
    const req = { cookies: { auth_token: token } };
    const res = { clearCookie: vi.fn() };
    const next = vi.fn();
    authMiddleware(req, res, next);
    expect(req.userId).toBe('u123');
    expect(req.username).toBe('test');
  });

  it('无效 cookie 设置 userId 为 null 并清除 cookie', () => {
    const req = { cookies: { auth_token: 'invalid.jwt.token' } };
    const res = { clearCookie: vi.fn() };
    const next = vi.fn();
    authMiddleware(req, res, next);
    expect(req.userId).toBeNull();
    expect(res.clearCookie).toHaveBeenCalledWith('auth_token', expect.any(Object));
  });

  it('requireAuth 有 userId 放行', () => {
    requireAuth({ userId: 'u1' }, {}, vi.fn());
  });

  it('requireAuth 无 userId 返回 401', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    requireAuth({ userId: null }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('generateToken 生成有效 JWT', () => {
    const token = generateToken({ userId: 'u1', username: 'test' });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });
});

describe('error.middleware', () => {
  let errorHandler;

  beforeEach(() => {
    delete require.cache[require.resolve('../src/middleware/error.middleware')];
    errorHandler = require('../src/middleware/error.middleware').errorHandler;
  });

  it('返回 500 和错误信息', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    errorHandler(new Error('测试'), {}, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('使用 err.statusCode', () => {
    const res = { json: vi.fn() };
    res.status = vi.fn(() => res);
    errorHandler({ statusCode: 400, message: '参数错' }, {}, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('响应包含 success: false', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    errorHandler(new Error('err'), {}, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

describe('response utils', () => {
  let successResponse, errorResponse;

  beforeEach(() => {
    delete require.cache[require.resolve('../src/utils/response')];
    const mod = require('../src/utils/response');
    successResponse = mod.successResponse;
    errorResponse = mod.errorResponse;
  });

  it('successResponse', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    successResponse(res, { x: 1 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Success', data: { x: 1 } });
  });

  it('errorResponse', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    errorResponse(res, '未找到', 404);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: '未找到' });
  });
});
