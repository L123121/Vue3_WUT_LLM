<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue';
import { Send, Bot, User, Sparkles, Loader2, Eraser } from 'lucide-vue-next';
import { useChatStore } from '../stores/chat.store.ts';
import { marked } from 'marked';

const chatStore = useChatStore();
const input = ref('');
const messagesEndRef = ref<HTMLElement | null>(null);

const scrollToBottom = () => {
  nextTick(() => {
    messagesEndRef.value?.scrollIntoView({ behavior: 'smooth' });
  });
};

watch(() => chatStore.messages.length, () => {
  scrollToBottom();
});

onMounted(() => {
  scrollToBottom();
});

const handleSend = () => {
  chatStore.sendMessage(input.value);
  input.value = '';
};

const parseMarkdown = (text: string) => {
  return marked.parse(text);
};

const formatTime = (date: Date) => {
  return new Date(date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}
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
            <span class="text-[10px] font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wide">Qwen3-1.7B Online</span>
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

    <!-- Messages -->
    <div class="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth">
      <div v-if="chatStore.messages.length === 0" class="flex flex-col items-center justify-center h-full text-slate-400 dark:text-gray-500 space-y-4 opacity-50">
        <Bot :size="48" class="stroke-1" />
        <p class="text-sm">你好，我是讯飞星辰 Qwen 助手...</p>
      </div>
      
      <div 
        v-for="msg in chatStore.messages" 
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
            'px-5 py-3.5 shadow-sm text-sm leading-relaxed relative',
            msg.role === 'user' 
              ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm' 
              : msg.isError 
                ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-800/50 rounded-2xl rounded-tl-sm'
                : 'bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 border border-slate-100 dark:border-gray-700 rounded-2xl rounded-tl-sm'
          ]">
            <div v-if="msg.role === 'model' && !msg.isError" 
                 class="prose prose-sm max-w-none prose-p:my-1 prose-headings:text-slate-800 dark:prose-headings:text-white prose-strong:text-slate-800 dark:prose-strong:text-white prose-code:text-pink-600 dark:prose-code:text-pink-400 dark:text-gray-200 prose-pre:bg-slate-100 dark:prose-pre:bg-gray-900 prose-pre:rounded-lg"
                 v-html="parseMarkdown(msg.text)"
            ></div>
            <div v-else>
              {{ msg.text }}
            </div>
            <div :class="['text-[9px] mt-1.5 opacity-60 text-right', msg.role === 'user' ? 'text-blue-100' : 'text-slate-400 dark:text-gray-500']">
              {{ formatTime(msg.timestamp) }}
            </div>
          </div>

        </div>
      </div>

      <div v-if="chatStore.isLoading" class="flex justify-start">
         <div class="flex items-center ml-10 bg-white dark:bg-gray-800 px-4 py-3 rounded-2xl rounded-tl-none border border-slate-100 dark:border-gray-700 shadow-sm">
            <Loader2 class="w-4 h-4 animate-spin text-blue-500 mr-2" />
            <span class="text-xs text-slate-500 dark:text-gray-400">正在思考中...</span>
         </div>
      </div>
      <div ref="messagesEndRef"></div>
    </div>

    <!-- Input -->
    <div class="p-4 bg-white dark:bg-gray-900 border-t border-slate-100 dark:border-gray-800 z-10">
      <div class="relative flex items-end gap-2 bg-slate-100 dark:bg-gray-800 rounded-2xl p-2 border border-transparent focus-within:border-blue-300 dark:focus-within:border-blue-700 focus-within:bg-white dark:focus-within:bg-gray-800 focus-within:ring-4 focus-within:ring-blue-100 dark:focus-within:ring-blue-900/20 transition-all duration-300">
        <textarea
          v-model="input"
          @keydown.enter.exact.prevent="handleSend"
          placeholder="输入您的问题..."
          :disabled="chatStore.isLoading"
          rows="1"
          class="w-full bg-transparent text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-gray-500 border-none focus:ring-0 px-3 py-2.5 outline-none resize-none max-h-32 text-sm"
          style="min-height: 44px;"
        ></textarea>
        <button 
          @click="handleSend"
          :disabled="!input.trim() || chatStore.isLoading"
          :class="[
            'p-2.5 rounded-xl transition-all duration-300 mb-0.5 shrink-0',
            !input.trim() || chatStore.isLoading 
              ? 'bg-slate-200 text-slate-400 dark:bg-gray-700 dark:text-gray-500 cursor-not-allowed' 
              : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-500/20 active:scale-95'
          ]"
        >
          <Sparkles v-if="chatStore.isLoading" :size="18" class="animate-spin" />
          <Send v-else :size="18" />
        </button>
      </div>
      <p class="text-center text-[10px] text-slate-400 dark:text-gray-600 mt-2">
        Powered by Xunfei Spark MaaS
      </p>
    </div>
  </div>
</template>