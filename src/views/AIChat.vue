<script setup>
import { ref, watch, nextTick, onMounted, computed } from 'vue';
import { useChatStore } from '../stores/chat.store.js';
import { useToastStore } from '../stores/toast.store.js';
import { useLanguageStore } from '../stores/language.store.js';
import { Bot, Eraser, MessageSquare } from 'lucide-vue-next';
import MessageList from '../components/chat/MessageList.vue';
import ChatBox from '../components/chat/ChatBox.vue';
import ConversationList from '../components/chat/ConversationList.vue';

const chatStore = useChatStore();
const toast = useToastStore();
const languageStore = useLanguageStore();
const text = computed(() => languageStore.tm('aiChat'));
const messageListRef = ref(null);

const currentTitle = computed(() => chatStore.currentConversation?.title || text.value.assistantTitle);
const conversationCount = computed(() => chatStore.conversations.length);
const sessionSummary = computed(() => languageStore.t('aiChat.sessionCount', { count: conversationCount.value }));

const handleSend = async (message) => {
  await chatStore.sendMessage(message);
  scrollToBottom();
};

const handleError = (message) => {
  toast.error(message);
};

const handleCopy = () => {
  toast.success(text.value.copied);
};

const scrollToBottom = async () => {
  await nextTick();
  messageListRef.value?.scrollToBottom();
};

watch(() => chatStore.messages.length, scrollToBottom);
watch(() => chatStore.currentConversationId, scrollToBottom);
onMounted(scrollToBottom);
</script>

<template>
  <div class="h-[calc(100vh-8rem)] grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-6">
    <aside class="hidden xl:flex flex-col bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-slate-200 dark:border-gray-800 overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-100 dark:border-gray-800 bg-slate-50/80 dark:bg-gray-900/70">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-500 to-indigo-400 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
            <MessageSquare :size="18" />
          </div>
          <div>
            <h3 class="text-sm font-bold text-slate-800 dark:text-white">{{ text.sessionTitle }}</h3>
            <p class="text-xs text-slate-500 dark:text-gray-400">{{ sessionSummary }}</p>
          </div>
        </div>
      </div>
      <div class="flex-1 overflow-hidden">
        <ConversationList />
      </div>
    </aside>

    <div class="flex flex-col min-h-0 gap-4 xl:gap-0">
      <div class="xl:hidden bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-slate-200 dark:border-gray-800 overflow-hidden">
        <ConversationList />
      </div>

      <div class="flex flex-col min-h-0 bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-slate-200 dark:border-gray-800 overflow-hidden animate-fade-in transition-all duration-300 ease-in-out relative">
        <div class="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none" style="background-image: radial-gradient(circle at 2px 2px, gray 1px, transparent 0); background-size: 24px 24px;"></div>

        <div class="bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm p-4 border-b border-slate-100 dark:border-gray-800 flex items-center justify-between z-10 gap-3">
          <div class="flex items-center min-w-0">
            <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-500 to-indigo-400 flex items-center justify-center mr-3 shadow-lg shadow-blue-500/20 text-white">
              <Bot :size="20" />
            </div>
            <div class="min-w-0">
              <h3 class="font-bold text-slate-800 dark:text-white text-sm truncate">{{ currentTitle }}</h3>
              <div class="flex items-center mt-0.5">
                <span class="w-1.5 h-1.5 rounded-full bg-blue-500 mr-1.5 animate-pulse"></span>
                <span class="text-[10px] font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wide">{{ text.model }}</span>
              </div>
            </div>
          </div>
          <button @click="chatStore.clearMessages" class="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 rounded-lg transition-colors duration-200" :title="text.clear">
            <Eraser :size="18" />
          </button>
        </div>

        <MessageList ref="messageListRef" :messages="chatStore.messages" :is-loading="chatStore.isLoading" :current-streaming-id="chatStore.currentStreamingId" @copy="handleCopy" />
        <ChatBox :is-loading="chatStore.isLoading" :placeholder="text.inputPlaceholder" @send="handleSend" @error="handleError" />
      </div>
    </div>
  </div>
</template>
