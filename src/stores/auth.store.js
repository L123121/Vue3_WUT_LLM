import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null);

  const login = (userData) => {
    user.value = {
      college: '计算机科学与技术学院',
      grade: '2021级',
      ...userData,
    };
  };

  const logout = () => {
    user.value = null;
  };

  const updateUser = (updates) => {
    if (user.value) {
      user.value = { ...user.value, ...updates };
    }
  };

  return { user, login, logout, updateUser };
});
