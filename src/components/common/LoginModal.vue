<script setup>
import { ref, computed } from 'vue';
import { useAuthStore } from '../../stores/auth.store.js';

const authStore = useAuthStore();
const emit = defineEmits(['close', 'success']);

const studentId = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');

const isFormValid = computed(() => studentId.value.length > 0 && password.value.length > 0);

async function handleSubmit() {
  if (!isFormValid.value || loading.value) return;

  loading.value = true;
  error.value = '';

  try {
    await authStore.casLogin(studentId.value, password.value);
    emit('success');
    emit('close');
  } catch (err) {
    error.value = err.message || '登录失败，请检查学号和密码';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" @click.self="$emit('close')">
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
      <!-- Header -->
      <div class="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-5">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-bold text-white">教务系统登录</h2>
            <p class="text-blue-100 text-xs mt-1">使用学号和教务系统密码登录</p>
          </div>
          <button
            @click="$emit('close')"
            :disabled="loading"
            class="text-blue-200 hover:text-white transition-colors disabled:opacity-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>

      <!-- Body -->
      <div class="px-6 py-6">
        <form @submit.prevent="handleSubmit" class="space-y-4">
          <!-- Student ID -->
          <div>
            <label class="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">
              学号
            </label>
            <input
              v-model="studentId"
              type="text"
              placeholder="请输入学号"
              :disabled="loading"
              autocomplete="username"
              class="w-full px-4 py-2.5 rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-slate-800 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 transition-all"
            />
          </div>

          <!-- Password -->
          <div>
            <label class="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">
              密码
            </label>
            <input
              v-model="password"
              type="password"
              placeholder="请输入教务系统密码"
              :disabled="loading"
              autocomplete="current-password"
              class="w-full px-4 py-2.5 rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-slate-800 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 transition-all"
            />
          </div>

          <!-- Error -->
          <div v-if="error" class="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-500 mt-0.5 shrink-0"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <p class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
          </div>

          <!-- Submit -->
          <button
            type="submit"
            :disabled="!isFormValid || loading"
            class="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-gray-600 text-white font-medium text-sm transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <!-- Spinner -->
            <svg v-if="loading" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
            <span>{{ loading ? '登录中...' : '登录' }}</span>
          </button>
        </form>

        <!-- Info -->
        <p class="text-xs text-slate-400 dark:text-gray-500 mt-4 text-center">
          登录后将自动绑定教务系统账号，可查询成绩、课表和考试安排
        </p>
      </div>
    </div>
  </div>
</template>
