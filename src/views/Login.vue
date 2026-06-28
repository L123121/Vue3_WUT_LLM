<template>
  <div class="min-h-screen relative flex items-center justify-center p-4 overflow-hidden bg-slate-50 dark:bg-gray-950">
    <div class="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
      <div class="absolute -top-[30%] -left-[10%] w-[70%] h-[70%] rounded-full bg-blue-800/20 blur-[120px] dark:bg-blue-900/20 animate-pulse"></div>
      <div class="absolute top-[40%] -right-[10%] w-[60%] h-[60%] rounded-full bg-cyan-600/20 blur-[100px] dark:bg-cyan-900/20 animate-pulse delay-700"></div>
    </div>

    <div class="w-full max-w-md relative z-10">
      <div class="bg-white/70 dark:bg-gray-900/60 backdrop-blur-xl rounded-3xl shadow-2xl dark:shadow-black/50 border border-white/50 dark:border-gray-700 overflow-hidden">
        <div class="pt-12 pb-8 px-10 text-center">
          <div class="flex justify-center mb-8">
            <div class="w-44 h-44 rounded-full overflow-hidden flex items-center justify-center transform hover:scale-105 transition-all duration-500 rotate-3 hover:rotate-0 shadow-[0_0_50px_rgba(37,99,235,0.2)]">
              <img src="/src/assets/wuhan-university-logo.png" alt="WUT Logo" class="w-full h-full object-cover scale-125 drop-shadow-2xl" />
            </div>
          </div>
          <h2 class="text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight">武理小精灵</h2>
          <p class="text-slate-500 dark:text-slate-400 mt-2 text-sm font-medium">使用教务系统账号登录</p>
        </div>

        <div class="px-10 pb-12">
          <form id="login-form" class="space-y-6" @submit.prevent="handleSubmit">
            <div class="space-y-4">
              <div>
                <label for="student-id" class="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 ml-1">学号</label>
                <div class="relative group">
                  <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <User class="h-5 w-5 text-slate-400 dark:text-slate-500 group-focus-within:text-blue-700 transition-colors duration-300" />
                  </div>
                  <input
                    id="student-id"
                    v-model="studentId"
                    type="text"
                    autocomplete="username"
                    :disabled="loading"
                    @keydown.enter="handleSubmit"
                    class="block w-full pl-11 pr-4 py-3.5 bg-slate-50/50 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-700/20 focus:border-blue-700 transition-all duration-200"
                    placeholder="请输入学号"
                  />
                </div>
              </div>

              <div>
                <label for="password" class="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 ml-1">教务系统密码</label>
                <div class="relative group">
                  <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock class="h-5 w-5 text-slate-400 dark:text-slate-500 group-focus-within:text-blue-700 transition-colors duration-300" />
                  </div>
                  <input
                    id="password"
                    v-model="password"
                    :type="showPassword ? 'text' : 'password'"
                    autocomplete="current-password"
                    :disabled="loading"
                    @keydown.enter="handleSubmit"
                    class="block w-full pl-11 pr-12 py-3.5 bg-slate-50/50 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-700/20 focus:border-blue-700 transition-all duration-200 disabled:opacity-70"
                    placeholder="请输入智慧理工大密码"
                  />
                  <button
                    type="button"
                    :disabled="loading"
                    @click="showPassword = !showPassword"
                    class="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 dark:text-slate-500 hover:text-blue-700 dark:hover:text-blue-400 transition-colors disabled:cursor-not-allowed"
                    :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                  >
                    <EyeOff v-if="showPassword" class="h-5 w-5" />
                    <Eye v-else class="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

            <div v-if="error" class="text-red-500 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/10 p-4 rounded-xl flex items-center">
              <div class="w-1.5 h-1.5 rounded-full bg-red-500 mr-2.5"></div>
              {{ error }}
            </div>

            <button
              type="submit"
              id="login-submit-btn"
              :disabled="loading"
              class="w-full flex justify-center items-center py-4 px-4 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-800 to-blue-600 hover:from-blue-900 hover:to-blue-700 dark:from-blue-700 dark:to-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-700/20 transition-all duration-300 shadow-lg shadow-blue-900/30 transform active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed"
            >
              <Loader2 v-if="loading" class="animate-spin -ml-1 mr-2 h-4 w-4" />
              {{ loading ? '验证中...' : '登录' }}
            </button>
          </form>

          <p class="text-center text-xs text-slate-400 dark:text-slate-500 mt-6">
            初始密码为 "Whut@身份证后6位"，如含 X 则大写
          </p>
        </div>

        <div class="bg-slate-50/80 dark:bg-gray-800/80 py-4 text-center border-t border-slate-100 dark:border-gray-700">
          <p class="text-xs text-slate-400 dark:text-gray-500">
            &copy; {{ new Date().getFullYear() }} 武汉理工大学 WUT
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.store.js';
import { API_BASE } from '../api/client.js';
import { User, Lock, Eye, EyeOff, Loader2 } from 'lucide-vue-next';

const router = useRouter();
const authStore = useAuthStore();
const loading = ref(false);
const error = ref('');
const showPassword = ref(false);
const studentId = ref('');
const password = ref('');

async function handleSubmit() {
  if (loading.value) return;

  const sid = studentId.value.trim();
  const pwd = password.value.trim();

  if (!sid || !pwd) {
    error.value = '请输入学号和密码';
    return;
  }

  loading.value = true;
  error.value = '';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(`${API_BASE}/school/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: sid, password: pwd }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await res.json().catch(() => null);

    if (res.ok && data?.success) {
      authStore.login(data.data.user);
      router.push('/chat');
    } else {
      if (data?.code === 'INVALID_CREDENTIALS') {
        error.value = '学号或密码错误，请重新输入';
      } else if (data?.code === 'SERVICE_UNAVAILABLE') {
        error.value = data?.message || '教务系统暂时不可用，请稍后重试';
      } else if (data?.code === 'NETWORK_ERROR') {
        error.value = '网络连接失败，暂时无法访问教务系统';
      } else {
        error.value = data?.message || '登录失败，请检查学号和密码是否正确';
      }
    }
  } catch (err) {
    console.error('[Login] Network error:', err);
    error.value = '无法连接到服务器，请确认是否已启动后端服务（在 backend 目录下运行 node src/app.js）';
  } finally {
    loading.value = false;
  }
}
</script>
