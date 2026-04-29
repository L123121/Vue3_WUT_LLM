<script setup>
import { computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import wutLogoImg from '../../assets/wuhan-university-logo.png';
import ConversationList from '../chat/ConversationList.vue';
import { Database, MessageSquare } from 'lucide-vue-next';

const wutLogo = wutLogoImg;
const router = useRouter();
const route = useRoute();
const currentPath = computed(() => route.path);
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
      </div>
    </div>

    <section class="flex-1 min-h-0 pb-2">
      <ConversationList />
    </section>
  </div>
</template>
