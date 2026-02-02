import { defineStore } from 'pinia';
import { ref } from 'vue';
import { User } from '../types/index.ts';
import router from '../router/index.ts';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);

  const login = (userData: User) => {
    user.value = userData;
    router.push('/');
  };

  const logout = () => {
    user.value = null;
    router.push('/login');
  };

  return { user, login, logout };
});