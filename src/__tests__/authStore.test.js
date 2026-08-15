import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from '../stores/auth.store.js';

describe('authStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('starts unauthenticated', () => {
    const store = useAuthStore();
    expect(store.isAuthenticated).toBe(false);
    expect(store.user).toBeNull();
  });

  // 以下用例依赖后端 API,需 mock fetch 或启动后端后再运行
  // TODO: 实现 mock fetch 或配置 CI 环境启动后端
  describe.skip('集成测试(需后端)', () => {
    it('logs in with user data', () => {
      const store = useAuthStore();
      store.login({ name: 'Test', studentId: '123' });

      expect(store.isAuthenticated).toBe(true);
      expect(store.user.name).toBe('Test');
      expect(store.user.studentId).toBe('123');
    });

    it('logs out and clears state', async () => {
      const store = useAuthStore();
      store.login({ name: 'Test', studentId: '123' });
      // Mock fetch for logout call
      global.fetch = vi.fn(() => Promise.resolve({ ok: true }));
      await store.logout();

      expect(store.isAuthenticated).toBe(false);
      expect(store.user).toBeNull();
      expect(localStorage.getItem('user')).toBeNull();
    });

    it('updates user profile', () => {
      const store = useAuthStore();
      store.login({ name: 'Old', studentId: '123' });
      store.updateUser({ name: 'New' });

      expect(store.user.name).toBe('New');
    });

    it('persists user to localStorage', () => {
      const store = useAuthStore();
      store.login({ name: 'Test', studentId: '123' });

      const stored = JSON.parse(localStorage.getItem('user'));
      expect(stored.name).toBe('Test');
      expect(stored.studentId).toBe('123');
    });

    it('does not persist token to localStorage', () => {
      const store = useAuthStore();
      store.login({ name: 'Test', studentId: '123' });

      expect(localStorage.getItem('token')).toBeNull();
    });
  });
});
