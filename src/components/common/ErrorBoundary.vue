<script setup>
import { ref, onErrorCaptured } from 'vue';
import { AlertTriangle, RefreshCw, WifiOff, ServerCrash, Bug } from 'lucide-vue-next';

const error = ref(null);
const errorType = ref('unknown');

// 技术错误 → 用户看得懂的话
const friendlyMessages = {
  network: '网络连接失败，请检查后端服务是否已启动',
  timeout: '请求超时，请稍后重试',
  auth: '登录已过期，请重新登录',
  notfound: '页面加载失败，请刷新重试',
  component: '页面组件加载失败',
  unknown: '页面遇到了一个意外错误',
};

const friendlyIcons = {
  network: WifiOff,
  timeout: ServerCrash,
  auth: AlertTriangle,
  component: Bug,
  unknown: AlertTriangle,
};

const classifyError = (err) => {
  const msg = (err?.message || err?.toString() || '').toLowerCase();
  if (!err) return 'unknown';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('networkerror') ||
      msg.includes('网络') || msg.includes('连接') || msg.includes('econnrefused')) return 'network';
  if (msg.includes('timeout') || msg.includes('超时')) return 'timeout';
  if (msg.includes('auth') || msg.includes('unauthorized') || msg.includes('401') ||
      msg.includes('登录') || msg.includes('token')) return 'auth';
  if (msg.includes('not found') || msg.includes('404') || msg.includes('chunk') ||
      msg.includes('loading') || msg.includes('load')) return 'component';
  return 'unknown';
};

onErrorCaptured((err) => {
  error.value = err;
  errorType.value = classifyError(err);
  console.error('[ErrorBoundary] 捕获错误:', err);
  return false;
});

const reload = () => {
  error.value = null;
  window.location.reload();
};
</script>

<template>
  <div v-if="error" class="flex flex-col items-center justify-center h-full p-8 text-center">
    <div class="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
      <component :is="friendlyIcons[errorType] || friendlyIcons.unknown" class="w-8 h-8 text-red-500" />
    </div>
    <h3 class="text-lg font-bold text-slate-800 dark:text-white mb-2">出了点问题</h3>
    <p class="text-sm text-slate-500 dark:text-gray-400 mb-6 max-w-md">
      {{ friendlyMessages[errorType] || friendlyMessages.unknown }}
    </p>
    <button
      @click="reload"
      class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
    >
      <RefreshCw :size="14" />
      刷新页面
    </button>
  </div>
  <slot v-else />
</template>
