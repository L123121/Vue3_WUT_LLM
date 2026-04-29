import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

const TOKEN_KEY = 'token';
const USER_KEY = 'user';
const PASSWORD_KEY = 'app_login_password';
const IS_LOCAL_AUTH_KEY = 'is_local_auth';

export const useAuthStore = defineStore('auth', () => {
  const user = ref(JSON.parse(localStorage.getItem(USER_KEY) || 'null'));
  const token = ref(localStorage.getItem(TOKEN_KEY) || '');
  const password = ref(localStorage.getItem(PASSWORD_KEY) || '123456');

  // 判断是否是本地认证：检查 token 是否以 'local_' 开头
  const storedToken = localStorage.getItem(TOKEN_KEY) || '';
  const storedIsLocalAuth = localStorage.getItem(IS_LOCAL_AUTH_KEY);
  // 优先使用存储的标志，如果没有则根据 token 前缀判断
  const isLocalAuth = ref(
    storedIsLocalAuth !== null
      ? storedIsLocalAuth === 'true'
      : storedToken.startsWith('local_')
  );

  console.log('[AuthStore] Init - token:', storedToken ? `${storedToken.substring(0, 20)}...` : 'empty');
  console.log('[AuthStore] Init - isLocalAuth:', isLocalAuth.value);

  const isAuthenticated = computed(() => !!token.value && !!user.value);

  const login = (userData, authToken) => {
    user.value = {
      college: '计算机科学与技术学院',
      grade: '2021级',
      ...userData,
    };

    // 如果有 token 则保存，否则生成本地 token
    if (authToken) {
      token.value = authToken;
      isLocalAuth.value = false;
      localStorage.setItem(TOKEN_KEY, authToken);
      localStorage.setItem(IS_LOCAL_AUTH_KEY, 'false');
    } else {
      // 本地验证时生成本地 token
      const localToken = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      token.value = localToken;
      isLocalAuth.value = true;
      localStorage.setItem(TOKEN_KEY, localToken);
      localStorage.setItem(IS_LOCAL_AUTH_KEY, 'true');
    }

    localStorage.setItem(USER_KEY, JSON.stringify(user.value));
  };

  const logout = () => {
    user.value = null;
    token.value = '';
    isLocalAuth.value = false;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(IS_LOCAL_AUTH_KEY);
  };

  const updateUser = (updates) => {
    if (user.value) {
      user.value = { ...user.value, ...updates };
      localStorage.setItem(USER_KEY, JSON.stringify(user.value));
    }
  };

  const verifyPassword = (value) => value === password.value;

  const changePassword = (currentPassword, newPassword) => {
    if (!verifyPassword(currentPassword)) {
      return { success: false, message: '旧密码错误 (提示: 默认密码是 123456)' };
    }

    if (!newPassword || newPassword.length < 6) {
      return { success: false, message: '新密码长度至少需要6位' };
    }

    password.value = newPassword;
    localStorage.setItem(PASSWORD_KEY, newPassword);
    return { success: true, message: '密码修改成功！' };
  };

  return {
    user,
    token,
    isLocalAuth,
    isAuthenticated,
    login,
    logout,
    updateUser,
    verifyPassword,
    changePassword
  };
});
