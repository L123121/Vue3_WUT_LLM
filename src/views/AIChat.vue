<script setup lang="ts">
// Vue 3 Composition API - 重构后的 AI 聊天页面
import { ref, watch, nextTick, onMounted } from 'vue';
import { useChatStore } from '../stores/chat.store';
import { useToastStore } from '../stores/toast.store';
import { Bot, Eraser } from 'lucide-vue-next';

// 高内聚组件
import MessageList from '../components/chat/MessageList.vue';
import ChatBox from '../components/chat/ChatBox.vue';

// 状态变量
const chatStore = useChatStore();
const toast = useToastStore();
const messageListRef = ref<InstanceType<typeof MessageList> | null>(null);

// 方法
const handleSend = async (message: string) => {
  await chatStore.sendMessage(message);
  scrollToBottom();
};

const handleError = (message: string) => {
  toast.error(message);
};

const handleCopy = (_text: string) => {
  toast.success('内容已复制到剪贴板');
};

const scrollToBottom = async () => {
  await nextTick();
  messageListRef.value?.scrollToBottom();
};

// 监听消息变化，自动滚动到底部
watch(
  () => chatStore.messages.length,
  () => {
    scrollToBottom();
  }
);

// 组件挂载后滚动到底部
onMounted(() => {
  scrollToBottom();
});
</script>

<template>
  <div class="h-[calc(100vh-8rem)] flex flex-col bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-slate-200 dark:border-gray-800 overflow-hidden animate-fade-in transition-all duration-300 ease-in-out relative">
    
    <!-- Background Pattern -->
    <div class="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none" 
         style="background-image: radial-gradient(circle at 2px 2px, gray 1px, transparent 0); background-size: 24px 24px;">
    </div>

    <!-- Header -->
    <div class="bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm p-4 border-b border-slate-100 dark:border-gray-800 flex items-center justify-between z-10">
      <div class="flex items-center">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-500 to-indigo-400 flex items-center justify-center mr-3 shadow-lg shadow-blue-500/20 text-white">
           <Bot :size="20" />
        </div>
        <div>
          <h3 class="font-bold text-slate-800 dark:text-white text-sm">AI 智能助手</h3>
          <div class="flex items-center mt-0.5">
            <span class="w-1.5 h-1.5 rounded-full bg-blue-500 mr-1.5 animate-pulse"></span>
            <span class="text-[10px] font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wide">GLM-4.7-Flash Online</span>
          </div>
        </div>
      </div>
      <button 
        @click="chatStore.clearMessages"
        class="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 rounded-lg transition-colors duration-200"
        title="清空对话"
      >
        <Eraser :size="18" />
      </button>
    </div>

    <!-- Messages - 使用虚拟列表组件 -->
    <MessageList
      ref="messageListRef"
      :messages="chatStore.messages"
      :is-loading="chatStore.isLoading"
      :current-streaming-id="chatStore.currentStreamingId"
      @copy="handleCopy"
    />

    <!-- Input - 使用 ChatBox 组件 -->
    <ChatBox
      :is-loading="chatStore.isLoading"
      placeholder="输入您的问题..."
      @send="handleSend"
      @error="handleError"
    />
  </div>
</template>
