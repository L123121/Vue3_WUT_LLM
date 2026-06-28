<script setup>
import { computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import wutLogoImg from '../../assets/wuhan-university-logo.png';
import ConversationList from '../chat/ConversationList.vue';
import { Database, MessageSquare, Settings, BarChart3, LogOut } from 'lucide-vue-next';
import { useAuthStore } from '../../stores/auth.store.js';

const wutLogo = wutLogoImg;
const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const currentPath = computed(() => route.path);

const showDevEval = import.meta.env.VITE_SHOW_DEV_EVAL === 'true';

const handleLogout = () => {
  authStore.logout();
  router.push('/login');
};
</script>

<template>
  <div class="w-72 h-screen bg-white/80 dark:bg-gray-900/95 backdrop-blur-md border-r border-slate-200 dark:border-gray-800 flex flex-col z-20 transition-all duration-300 ease-in-out">
    <div class="p-6 pt-8 flex flex-col items-start justify-center">
      <div class="flex items-center gap-3 mb-2 px-2">
        <div class="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center shrink-0">
          <img :src="wutLogo" alt="WUT Logo" class="w-full h-full object-cover scale-125 drop-shadow-md" />
        </div>
        <div>
          <h1 class="text-xl font-extrabold tracking-tight text-slate-800 dark:text-white leading-tight">武理小精灵</h1>
          <p class="text-[10px] font-bold text-blue-800 dark:text-blue-400 tracking-widest uppercase mt-0.5 opacity-90">WUT Assistant</p>
        </div>
      </div>
    </div>

    <!-- 导航标签 -->
    <div class="px-3 mb-2">
      <div class="flex gap-1 p-1 rounded-lg bg-slate-100 dark:bg-gray-800">
        <button
          @click="router.push('/chat')"
          :class="[
            'flex-1 h-8 rounded-md text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
            currentPath === '/chat'
              ? 'bg-white dark:bg-gray-700 text-slate-800 dark:text-white shadow-sm'
              : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200'
          ]"
        >
          <MessageSquare :size="14" />
          <span>对话</span>
        </button>
        <button
          @click="router.push('/knowledge')"
          :class="[
            'flex-1 h-8 rounded-md text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
            currentPath === '/knowledge'
              ? 'bg-white dark:bg-gray-700 text-slate-800 dark:text-white shadow-sm'
              : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200'
          ]"
        >
          <Database :size="14" />
          <span>知识库</span>
        </button>
        <button
          v-if="showDevEval"
          @click="router.push('/eval')"
          :class="[
            'flex-1 h-8 rounded-md text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
            currentPath === '/eval'
              ? 'bg-white dark:bg-gray-700 text-slate-800 dark:text-white shadow-sm'
              : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200'
          ]"
        >
          <BarChart3 :size="14" />
          <span>评测</span>
        </button>
        <button
          @click="router.push('/settings')"
          :class="[
            'h-8 w-8 rounded-md inline-flex items-center justify-center transition-colors',
            currentPath === '/settings'
              ? 'bg-white dark:bg-gray-700 text-slate-800 dark:text-white shadow-sm'
              : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200'
          ]"
        >
          <Settings :size="14" />
        </button>
      </div>
    </div>

    <section class="flex-1 min-h-0 pb-2">
      <ConversationList />
    </section>

    <!-- 底部用户信息 + 退出 -->
    <div class="shrink-0 px-3 py-3 border-t border-slate-200 dark:border-gray-800">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-400 flex items-center justify-center text-white text-xs font-bold shrink-0">
          {{ (authStore.user?.name || '?')[0] }}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-slate-700 dark:text-gray-200 truncate">{{ authStore.user?.name || '用户' }}</div>
        </div>
        <button
          @click="handleLogout"
          class="p-1.5 rounded-lg text-slate-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          title="退出登录"
        >
          <LogOut :size="16" />
        </button>
      </div>
    </div>
  </div>
</template>
