<script setup lang="ts">
import { ref } from 'vue';
import { useAuthStore } from '../stores/auth.store.ts';
import { User, Lock, ArrowRight, Loader2, GraduationCap } from 'lucide-vue-next';

const authStore = useAuthStore();

const username = ref('');
const password = ref('');
const isLoading = ref(false);
const error = ref('');

const handleSubmit = async () => {
  if (!username.value || !password.value) {
    error.value = '请输入用户名和密码';
    return;
  }

  isLoading.value = true;
  error.value = '';

  // Simulate API call
  setTimeout(() => {
    if (password.value === '123456') { // Mock validation
      authStore.login({
        id: 'u1',
        name: username.value || '武理学子',
        avatar: 'https://api.dicebear.com/7.x/notionists/svg?seed=Felix'
      });
    } else {
      error.value = '用户名或密码错误 (提示: 密码是 123456)';
      isLoading.value = false;
    }
  }, 1000);
};
</script>

<template>
  <div class="min-h-screen relative flex items-center justify-center p-4 overflow-hidden bg-slate-50 dark:bg-gray-950 transition-colors duration-500">
    <!-- Dynamic Background -->
    <div class="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
      <div class="absolute -top-[30%] -left-[10%] w-[70%] h-[70%] rounded-full bg-blue-800/20 blur-[120px] dark:bg-blue-900/20 animate-pulse"></div>
      <div class="absolute top-[40%] -right-[10%] w-[60%] h-[60%] rounded-full bg-cyan-600/20 blur-[100px] dark:bg-cyan-900/20 animate-pulse delay-700"></div>
    </div>

    <div class="w-full max-w-md relative z-10">
      <div class="bg-white/70 dark:bg-gray-900/60 backdrop-blur-xl rounded-3xl shadow-2xl dark:shadow-black/50 border border-white/50 dark:border-gray-700 overflow-hidden transition-all duration-300">
        
        <!-- Header Section -->
        <div class="pt-12 pb-8 px-10 text-center">
          <div class="flex justify-center mb-8">
            <div class="w-24 h-24 rounded-3xl bg-gradient-to-br from-blue-900 to-blue-700 flex items-center justify-center shadow-2xl shadow-blue-900/30 transform hover:scale-105 transition-all duration-500 rotate-3 hover:rotate-0 ring-4 ring-white/50 dark:ring-gray-700/50">
               <GraduationCap :size="48" class="text-yellow-400 drop-shadow-md" :strokeWidth="1.5" />
            </div>
          </div>
          <h2 class="text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight">欢迎回来</h2>
          <p class="text-slate-500 dark:text-slate-400 mt-2 text-sm font-medium">武理小精灵 · 您的智慧校园助手</p>
        </div>

        <!-- Form Section -->
        <div class="px-10 pb-12">
          <form @submit.prevent="handleSubmit" class="space-y-6">
            <div class="space-y-4">
              <div>
                <label class="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 ml-1">学号 / 账号</label>
                <div class="relative group">
                  <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <User class="h-5 w-5 text-slate-400 dark:text-slate-500 group-focus-within:text-blue-700 transition-colors duration-300" />
                  </div>
                  <input
                    type="text"
                    v-model="username"
                    class="block w-full pl-11 pr-4 py-3.5 bg-slate-50/50 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-700/20 focus:border-blue-700 transition-all duration-200"
                    placeholder="请输入您的学号"
                  />
                </div>
              </div>

              <div>
                <label class="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 ml-1">密码</label>
                <div class="relative group">
                  <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock class="h-5 w-5 text-slate-400 dark:text-slate-500 group-focus-within:text-blue-700 transition-colors duration-300" />
                  </div>
                  <input
                    type="password"
                    v-model="password"
                    class="block w-full pl-11 pr-4 py-3.5 bg-slate-50/50 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-700/20 focus:border-blue-700 transition-all duration-200"
                    placeholder="请输入密码"
                  />
                </div>
              </div>
            </div>

            <div v-if="error" class="text-red-500 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/10 p-4 rounded-xl flex items-center animate-in fade-in slide-in-from-top-2">
              <div class="w-1.5 h-1.5 rounded-full bg-red-500 mr-2.5"></div>
              {{ error }}
            </div>

            <button
              type="submit"
              :disabled="isLoading"
              class="w-full flex justify-center items-center py-4 px-4 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-800 to-blue-600 hover:from-blue-900 hover:to-blue-700 dark:from-blue-700 dark:to-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-700/20 transition-all duration-300 shadow-lg shadow-blue-900/30 transform active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed"
            >
              <template v-if="isLoading">
                <Loader2 class="animate-spin -ml-1 mr-2 h-4 w-4" />
                登录中...
              </template>
              <template v-else>
                立即登录 <ArrowRight class="ml-2 h-4 w-4" />
              </template>
            </button>
          </form>
        </div>
        
        <div class="bg-slate-50/80 dark:bg-gray-800/80 py-4 text-center border-t border-slate-100 dark:border-gray-700">
           <p class="text-xs text-slate-400 dark:text-gray-500">
             &copy; {{ new Date().getFullYear() }} 武汉理工大学 WUT
           </p>
        </div>
      </div>
      
      <p class="text-center text-slate-400 dark:text-slate-500 text-xs mt-8">
         遇到问题? 联系管理员获得帮助
      </p>
    </div>
  </div>
</template>