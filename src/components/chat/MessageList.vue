<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue';
import { Bot, User, Sparkles, Loader2, Copy } from 'lucide-vue-next';
import MarkdownRenderer from './MarkdownRenderer.vue';
import type { ChatMessage } from '../../types/index';

const props = defineProps<{
  messages: ChatMessage[];
  isLoading?: boolean;
  currentStreamingId?: string | null;
}>();

const emit = defineEmits<{
  (e: 'copy', text: string): void;
}>();

const messagesEndRef = ref<HTMLElement | null>(null);

// 格式化时间
const formatTime = (timestamp: number | string | Date) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  });
};

// 滚动到底部
const scrollToBottom = async () => {
  await nextTick();
  if (messagesEndRef.value) {
    messagesEndRef.value.scrollIntoView({ behavior: 'smooth' });
  }
};

// 复制消息
const copyMessage = (text: string) => {
  navigator.clipboard.writeText(text).then(() => {
    emit('copy', text);
  });
};

// 监听消息变化，自动滚动到底部
watch(
  () => props.messages.length,
  () => {
    scrollToBottom();
  }
);

// 监听流式消息更新，保持滚动
watch(
  () => {
    if (props.currentStreamingId) {
      const msg = props.messages.find(m => m.id === props.currentStreamingId);
      return msg?.text.length || 0;
    }
    return 0;
  },
  () => {
    scrollToBottom();
  }
);

onMounted(() => {
  scrollToBottom();
});

// 暴露给父组件
defineExpose({
  scrollToBottom
});
</script>

<template>
  <div class="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth">
    <!-- 空状态 -->
    <div v-if="messages.length === 0" class="flex flex-col items-center justify-center h-full text-slate-400 dark:text-gray-500 space-y-4 opacity-50">
      <Bot :size="48" class="stroke-1" />
      <p class="text-sm">你好，我是讯飞星辰 Qwen 助手...</p>
    </div>
    
    <!-- 消息列表 -->
    <div 
      v-for="msg in messages" 
      :key="msg.id"
      :class="['flex', msg.role === 'user' ? 'justify-end' : 'justify-start', 'group']"
    >
      <div :class="['flex max-w-[85%] md:max-w-[75%]', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row', 'items-end gap-2']">
        
        <!-- Avatar -->
        <div :class="[
          'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm overflow-hidden',
          msg.role === 'user' 
            ? 'bg-blue-100 dark:bg-blue-900/30' 
            : 'bg-gradient-to-tr from-blue-500 to-indigo-400 text-white'
        ]">
          <User v-if="msg.role === 'user'" :size="14" class="text-blue-600 dark:text-blue-400" />
          <Sparkles v-else :size="14" />
        </div>

        <!-- Bubble -->
        <div :class="[
          'px-5 py-3.5 shadow-sm text-sm leading-relaxed relative max-w-full overflow-hidden',
          msg.role === 'user' 
            ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm' 
            : msg.isError 
              ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-800/50 rounded-2xl rounded-tl-sm'
              : 'bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 border border-slate-100 dark:border-gray-700 rounded-2xl rounded-tl-sm',
          (msg.role === 'model' && !msg.isError) ? 'pr-16' : ''
        ]">
          <!-- AI 消息使用 Markdown 渲染 -->
          <MarkdownRenderer 
            v-if="msg.role === 'model' && !msg.isError"
            :content="msg.text"
          />
          
          <!-- 复制按钮 -->
          <button
            v-if="msg.role === 'model' && !msg.isError && msg.text"
            class="copy-btn absolute top-2 right-3 flex items-center gap-1.5 hover:text-blue-500 transition-all duration-200 cursor-pointer px-2 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-gray-700 text-xs text-slate-400"
            @click="copyMessage(msg.text)"
            title="复制回复"
          >
            <Copy :size="12" />
            <span>复制</span>
          </button>
          
          <!-- 用户消息 -->
          <div v-if="msg.role === 'user'" class="whitespace-pre-wrap leading-relaxed">{{ msg.text }}</div>
          
          <!-- 错误消息 -->
          <div v-if="msg.isError" class="whitespace-pre-wrap leading-relaxed">{{ msg.text }}</div>
          
          <!-- 时间戳 -->
          <div :class="['text-[9px] mt-1.5 opacity-60 text-right', msg.role === 'user' ? 'text-blue-100' : 'text-slate-400 dark:text-gray-500']">
            {{ formatTime(msg.timestamp) }}
          </div>
        </div>

      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="isLoading && !currentStreamingId" class="flex justify-start">
      <div class="flex items-center ml-10 bg-white dark:bg-gray-800 px-4 py-3 rounded-2xl rounded-tl-none border border-slate-100 dark:border-gray-700 shadow-sm">
        <Loader2 class="w-4 h-4 animate-spin text-blue-500 mr-2" />
        <span class="text-xs text-slate-500 dark:text-gray-400">正在思考中...</span>
      </div>
    </div>
    
    <div ref="messagesEndRef"></div>
  </div>
</template>
