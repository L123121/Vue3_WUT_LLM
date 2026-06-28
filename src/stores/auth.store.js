import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

const USER_KEY = 'user';

export const useAuthStore = defineStore('auth', () => {
  const user = ref(JSON.parse(localStorage.getItem(USER_KEY) || 'null'));

  const isAuthenticated = computed(() => !!user.value);

  const login = (userData) => {
    user.value = userData || null;
    localStorage.setItem(USER_KEY, JSON.stringify(user.value));
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // 登出请求失败不影响本地清理
    }
    user.value = null;
    localStorage.removeItem(USER_KEY);
  };

  const updateUser = (updates) => {
    if (user.value) {
      user.value = { ...user.value, ...updates };
      localStorage.setItem(USER_KEY, JSON.stringify(user.value));
    }
  };

  return {
    user,
    isAuthenticated,
    login,
    logout,
    updateUser,
  };
});
