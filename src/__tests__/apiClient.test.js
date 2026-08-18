import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet, configureAuthErrorHandler } from '../api/client.js';

describe('api client authentication handling', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    configureAuthErrorHandler(null);
  });

  it('does not import the router and delegates navigation on 401', async () => {
    const navigate = vi.fn();
    configureAuthErrorHandler(navigate);
    localStorage.setItem('user', JSON.stringify({ id: 'user-1' }));
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: '登录已过期' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 204 });

    await expect(apiGet('/private')).rejects.toMatchObject({ status: 401 });
    await Promise.resolve();
    await Promise.resolve();

    expect(localStorage.getItem('user')).toBeNull();
    expect(navigate).toHaveBeenCalledOnce();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
  });
});
