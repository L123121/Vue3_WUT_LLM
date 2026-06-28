import { describe, it, expect, beforeEach, vi } from 'vitest';

// 模拟依赖
vi.mock('../src/services/memory-store', () => {
  const store = new Map();
  const sets = new Map();
  return {
    redis: {
      hgetall: vi.fn(async (k) => store.get(k) || null),
      hset: vi.fn(async (k, ...args) => {
        if (!store.has(k)) store.set(k, {});
        const obj = store.get(k);
        if (args.length === 1 && typeof args[0] === 'object') Object.assign(obj, args[0]);
        else for (let i = 0; i < args.length; i += 2) obj[args[i]] = args[i + 1];
        return args.length / 2;
      }),
      hget: vi.fn(async (k, f) => (store.get(k) || {})[f] || null),
      hdel: vi.fn(async (k, f) => { delete (store.get(k) || {})[f]; return 1; }),
      del: vi.fn(async (k) => { store.delete(k); sets.delete(k); return 1; }),
      rpush: vi.fn(async (k, v) => {
        if (!store.has(k)) store.set(k, []);
        store.get(k).push(v); return 1;
      }),
      lrange: vi.fn(async (k, start, end) => {
        const list = store.get(k) || [];
        return end === -1 ? list.slice(start) : list.slice(start, end + 1);
      }),
      expire: vi.fn(async () => {}),
    },
  };
});

// 模拟 config 模块（vitest 环境下避免读取 .env）
vi.mock('../src/config', () => ({
  school: {
    jwHost: 'https://jwxt.whut.edu.cn',
    encKey: 'test-enc-key-32bytes!!!!!!!!!!!!',
    browserDebugPort: 9222,
    sessionTTL: 7200000,
  },
}));

describe('SchoolSessionService', () => {
  let sessionService;

  beforeEach(async () => {
    vi.clearAllMocks();
    // vitest 的 vi.mock 对 CJS require 需要额外设置 encKey
    const config = require('../src/config');
    config.school = config.school || {};
    config.school.encKey = config.school.encKey || 'test-enc-key-32bytes!!!!!!!!!!!!';
    delete require.cache[require.resolve('../src/services/school-session.service')];
    sessionService = require('../src/services/school-session.service');
    sessionService.sessions = new Map();
  });

  describe('加密/解密', () => {
    it('encrypt / decrypt 往返', () => {
      const original = 'mypassword123';
      const encrypted = sessionService.encrypt(original);
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('tag');
      expect(encrypted).toHaveProperty('data');
      expect(sessionService.decrypt(encrypted)).toBe(original);
    });

    it('相同的输入产生不同的密文', () => {
      const e1 = sessionService.encrypt('same');
      const e2 = sessionService.encrypt('same');
      expect(e1.iv).not.toBe(e2.iv);
    });
  });

  describe('Session 管理', () => {
    it('invalidateSession 清除缓存', () => {
      sessionService.sessions.set('u1', { cookies: 'test', expiresAt: Date.now() + 10000 });
      expect(sessionService.sessions.has('u1')).toBe(true);
      sessionService.invalidateSession('u1');
      expect(sessionService.sessions.has('u1')).toBe(false);
    });
  });

  describe('错误规范化', () => {
    it('INVALID_CREDENTIALS 透传', () => {
      const err = sessionService._normalizeLoginError({ code: 'INVALID_CREDENTIALS', message: '密码错' });
      expect(err.code).toBe('INVALID_CREDENTIALS');
      expect(err.message).toBe('密码错');
    });

    it('超时转为 NETWORK_ERROR', () => {
      const err = sessionService._normalizeLoginError({ name: 'TimeoutError', message: 'timeout' });
      expect(err.code).toBe('NETWORK_ERROR');
      expect(err.message).toContain('超时');
    });

    it('网络错误转为 NETWORK_ERROR', () => {
      const err = sessionService._normalizeLoginError({ message: 'net::ERR', code: 'ECONNREFUSED' });
      expect(err.code).toBe('NETWORK_ERROR');
    });

    it('未知错误转为 UNKNOWN_ERROR', () => {
      const err = sessionService._normalizeLoginError(new Error('奇怪错误'));
      expect(err.code).toBe('UNKNOWN_ERROR');
    });

    it('已知错误码直接透传', () => {
      const err = sessionService._normalizeLoginError({ code: 'SERVICE_UNAVAILABLE', message: '服务不可用' });
      expect(err.code).toBe('SERVICE_UNAVAILABLE');
    });
  });
});
