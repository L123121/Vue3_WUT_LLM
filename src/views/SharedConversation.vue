<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Bot, User, MessageCircle, Home, ExternalLink } from 'lucide-vue-next';
import { fetchSharedSnapshot } from '../api/share.js';
import MarkdownRenderer from '../components/chat/MarkdownRenderer.vue';

const route = useRoute();
const router = useRouter();

const snapshot = ref(null);
const loading = ref(true);
const error = ref('');

const formatTime = (timestamp) => {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return '';
  }
};

const goHome = () => router.push('/chat');

onMounted(async () => {
  const code = route.params.code;
  if (!code) {
    error.value = '分享链接无效';
    loading.value = false;
    return;
  }
  try {
    const data = await fetchSharedSnapshot(code);
    if (!data) {
      error.value = '分享已失效或不存在';
    } else {
      snapshot.value = data;
    }
  } catch (err) {
    console.error('[Share] 读取分享失败:', err);
    error.value = '读取分享失败，请稍后重试';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="min-h-screen bg-slate-50 dark:bg-gray-950 flex flex-col">
    <!-- 顶部导航 -->
    <header class="sticky top-0 z-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border-b border-slate-200 dark:border-gray-800">
      <div class="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
        <div class="flex items-center gap-2 min-w-0">
          <div class="w-8 h-8 rounded-lg bg-wut-600 flex items-center justify-center text-white shrink-0">
            <Bot :size="16" />
          </div>
          <div class="min-w-0">
            <h1 class="text-sm font-bold text-slate-800 dark:text-white truncate">武理小精灵 · 对话分享</h1>
            <p class="text-[10px] text-slate-400 dark:text-gray-500">只读快照 · 由对话发起者分享</p>
          </div>
        </div>
        <button
          @click="goHome"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
        >
          <Home :size="14" />
          去提问
        </button>
      </div>
    </header>

    <main class="flex-1 w-full max-w-3xl mx-auto px-4 py-6">
      <!-- 加载中 -->
      <div v-if="loading" class="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-gray-500">
        <MessageCircle :size="32" class="mb-3 animate-pulse" />
        <p class="text-sm">正在加载分享内容...</p>
      </div>

      <!-- 错误 -->
      <div v-else-if="error" class="flex flex-col items-center justify-center py-20 text-slate-500 dark:text-gray-400">
        <MessageCircle :size="40" class="mb-3 opacity-30" />
        <p class="text-sm font-medium">{{ error }}</p>
        <button
          @click="goHome"
          class="mt-4 px-4 py-2 rounded-lg text-xs font-medium bg-wut-600 text-white hover:bg-wut-700 transition-colors"
        >
          返回提问
        </button>
      </div>

      <!-- 快照内容 -->
      <template v-else-if="snapshot">
        <div class="mb-6">
          <h2 class="text-xl font-bold text-slate-800 dark:text-white">{{ snapshot.title }}</h2>
          <p class="mt-1 text-xs text-slate-400 dark:text-gray-500">
            分享于 {{ formatTime(snapshot.createdAt) }} · 共 {{ snapshot.messages.length }} 条消息
          </p>
        </div>

        <div class="space-y-4">
          <div v-for="(msg, index) in snapshot.messages" :key="index" class="flex" :class="msg.role === 'user' ? 'justify-end' : 'justify-start'">
            <div class="flex items-start gap-2 max-w-[85%]" :class="msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'">
              <div
                class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm"
                :class="msg.role === 'user' ? 'bg-wut-100 dark:bg-wut-900/30 text-wut-600 dark:text-wut-400' : 'bg-wut-600 text-white'"
              >
                <User v-if="msg.role === 'user'" :size="14" />
                <Bot v-else :size="15" />
              </div>
              <div
                class="px-4 py-3 shadow-sm text-sm leading-relaxed rounded-2xl"
                :class="msg.role === 'user'
                  ? 'bg-wut-600 text-white rounded-tr-sm'
                  : 'bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 border border-slate-100 dark:border-gray-700 rounded-tl-sm'"
              >
                <MarkdownRenderer v-if="msg.role !== 'user'" :content="msg.text" :sources="[]" />
                <div v-else class="whitespace-pre-wrap">{{ msg.text }}</div>
                <div class="flex items-center justify-end mt-1.5 gap-2">
                  <span class="text-xs opacity-60">{{ formatTime(msg.timestamp) }}</span>
                  <a
                    :href="`${window.location.origin}/share/${route.params.code}`"
                    target="_blank"
                    class="flex items-center gap-1 text-[10px] opacity-50 hover:opacity-100 transition-opacity"
                    :title="'打开原始分享链接'"
                  >
                    <ExternalLink :size="10" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </main>

    <footer class="py-6 text-center text-[11px] text-slate-300 dark:text-gray-700">
      武理小精灵 WUT Assistant · 本页面为对话只读快照
    </footer>
  </div>
</template>
