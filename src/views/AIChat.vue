<script setup lang="ts">
// Vue 3 Composition API
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useChatStore } from '../stores/chat.store';
import { useToastStore } from '../stores/toast.store';
import { Send, Bot, User, Eraser, Sparkles, Loader2, Copy } from 'lucide-vue-next';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css'; // 引入代码高亮样式

// 配置 marked 自定义渲染器
const renderer = new marked.Renderer();

renderer.code = (code, language) => {
  const validLang = hljs.getLanguage(language || '') ? language : 'plaintext';
  const highlighted = hljs.highlight(code, validLang || 'plaintext').value;
  // 对代码进行 URL 编码，以便安全地放入 data 属性中
  const encodedCode = encodeURIComponent(code);
  
  return `
    <div class="code-block-wrapper my-3 rounded-lg overflow-hidden bg-[#282c34] text-white shadow-md border border-slate-700">
      <div class="flex items-center justify-between px-3 py-1.5 bg-[#21252b] text-xs text-gray-400 select-none border-b border-slate-700">
        <span class="font-mono font-medium opacity-80">${validLang || 'text'}</span>
        <button 
          class="copy-btn flex items-center gap-1.5 hover:text-white transition-all duration-200 cursor-pointer px-2 py-0.5 rounded hover:bg-white/10"
          data-code="${encodedCode}"
        >
          <span class="copy-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          </span>
          <span class="copy-text">复制</span>
        </button>
      </div>
      <pre class="!m-0 !p-4 overflow-x-auto bg-[#282c34] font-mono text-sm leading-normal"><code class="hljs language-${validLang}">${highlighted}</code></pre>
    </div>
  `;
};

marked.use({ renderer });

// 状态变量
const chatStore = useChatStore();
const toast = useToastStore();
const input = ref('');
const messagesEndRef = ref<HTMLElement | null>(null);

// 处理全局点击事件（用于代码复制）
const handleGlobalClick = (event: MouseEvent) => {
  const target = (event.target as HTMLElement).closest('.copy-btn');
  if (target) {
    const btn = target as HTMLElement;
    const code = decodeURIComponent(btn.getAttribute('data-code') || '');
    if (code) {
      navigator.clipboard.writeText(code).then(() => {
        // 全局通知
        toast.success('代码已复制到剪贴板');
        
        // 按钮反馈
        const iconSpan = btn.querySelector('.copy-icon');
        const textSpan = btn.querySelector('.copy-text');
        
        if (iconSpan && textSpan) {
          const originalIcon = iconSpan.innerHTML;
          const originalText = textSpan.innerHTML;
          
          iconSpan.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
          textSpan.innerHTML = '<span class="text-green-400">已复制</span>';
          textSpan.classList.add('text-green-400');
          
          setTimeout(() => {
            iconSpan.innerHTML = originalIcon;
            textSpan.innerHTML = originalText;
            textSpan.classList.remove('text-green-400');
          }, 2000);
        }
      });
    }
  }
};

// （已移除）重复的监听，使用基于 messages.length 的 watch 来滚动

// 方法
const handleSend = async () => {
  if (!input.value.trim() || chatStore.isLoading) return;
  
  const message = input.value.trim();
  input.value = '';
  
  await chatStore.sendMessage(message);
  scrollToBottom();
};

const scrollToBottom = async () => {
  await nextTick();
  if (messagesEndRef.value) {
    messagesEndRef.value.scrollIntoView({ behavior: 'smooth' });
  }
};

const parseMarkdown = (text: string) => {
  try {
    return marked.parse(text, { async: false }) as string;
  } catch (e) {
    console.error('Markdown parsing error:', e);
    return text;
  }
};

const formatTime = (timestamp: number | string | Date) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  });
};

// 监听消息变化，自动滚动到底部
watch(
  () => chatStore.messages.length,
  () => {
    scrollToBottom();
  }
);

// 组件挂载后滚动到底部并绑定全局点击处理（用于复制）
onMounted(() => {
  scrollToBottom();
  window.addEventListener('click', handleGlobalClick);
});

onUnmounted(() => {
  window.removeEventListener('click', handleGlobalClick);
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
            'px-5 py-3.5 shadow-sm text-sm leading-relaxed relative max-w-full overflow-hidden',
            msg.role === 'user' 
              ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm' 
              : msg.isError 
                ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-800/50 rounded-2xl rounded-tl-sm'
                : 'bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 border border-slate-100 dark:border-gray-700 rounded-2xl rounded-tl-sm',
            (msg.role === 'model' && !msg.isError) ? 'pr-16' : ''
          ]">
            <div 
              v-if="msg.role === 'model' && !msg.isError"
              class="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed
                prose-p:my-1.5 prose-p:leading-relaxed
                prose-headings:font-bold prose-headings:my-2 prose-h1:text-lg prose-h2:text-base prose-h3:text-sm
                prose-ul:my-1 prose-ul:list-disc prose-ul:pl-4
                prose-ol:my-1 prose-ol:list-decimal prose-ol:pl-4
                prose-li:my-0.5
                prose-pre:my-2 prose-pre:p-0 prose-pre:bg-transparent prose-pre:rounded-lg
                prose-code:px-1 prose-code:py-0.5 prose-code:bg-slate-100 dark:prose-code:bg-gray-700 prose-code:rounded prose-code:text-pink-500 dark:prose-code:text-pink-400 prose-code:font-mono prose-code:text-xs prose-code:before:content-[''] prose-code:after:content-['']
                prose-strong:font-bold prose-strong:text-slate-900 dark:prose-strong:text-white
                prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
                prose-table:my-2 prose-table:w-full prose-table:text-left prose-table:border-collapse
                prose-th:p-2 prose-th:border prose-th:border-slate-200 dark:prose-th:border-gray-700 prose-th:bg-slate-50 dark:prose-th:bg-gray-800
                prose-td:p-2 prose-td:border prose-td:border-slate-200 dark:prose-td:border-gray-700"
              v-html="parseMarkdown(msg.text)"
            ></div>
            <button
              v-if="msg.role === 'model' && !msg.isError"
              class="copy-btn absolute top-2 right-3 flex items-center gap-1.5 hover:text-white transition-all duration-200 cursor-pointer px-2 py-0.5 rounded hover:bg-white/10 text-xs text-slate-400"
              :data-code="encodeURIComponent(msg.text)"
              title="复制回复"
            >
              <span class="copy-icon">
                <Copy :size="12" />
              </span>
              <span class="copy-text">复制</span>
            </button>
            <div v-else class="whitespace-pre-wrap leading-relaxed">{{ msg.text }}</div>
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