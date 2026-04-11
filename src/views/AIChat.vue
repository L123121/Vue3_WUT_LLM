<script setup>
import { ref, watch, nextTick, onMounted, computed } from 'vue';
import { useChatStore } from '../stores/chat.store.js';
import { useToastStore } from '../stores/toast.store.js';
import { useLanguageStore } from '../stores/language.store.js';
import { useThemeStore } from '../stores/theme.store.js';
import { Bot, Eraser, Sparkles, Moon, Sun } from 'lucide-vue-next';
import MessageList from '../components/chat/MessageList.vue';
import ChatBox from '../components/chat/ChatBox.vue';
import SkillPanel from '../components/chat/SkillPanel.vue';

const chatStore = useChatStore();
const toast = useToastStore();
const languageStore = useLanguageStore();
const themeStore = useThemeStore();
const text = computed(() => languageStore.tm('aiChat'));
const messageListRef = ref(null);
const showSkillPanel = ref(false);

const currentTitle = computed(() => chatStore.currentConversation?.title || text.value.assistantTitle);
const effectiveMessageCount = computed(() => chatStore.messages.filter((msg) => msg.id !== 'welcome' && msg.text?.trim()).length);
const canClear = computed(() => effectiveMessageCount.value > 0 && !chatStore.isLoading);
const inputHint = computed(() => (languageStore.isChinese ? 'Enter 发送，Shift + Enter 换行' : 'Press Enter to send, Shift + Enter for new line'));
const skillButtonText = computed(() => (languageStore.isChinese ? 'Skills' : 'Skills'));
const themeButtonText = computed(() => (themeStore.darkMode
  ? (languageStore.isChinese ? '夜间模式' : 'Dark Mode')
  : (languageStore.isChinese ? '日间模式' : 'Light Mode')));

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
  <div class="h-[calc(100vh-8rem)]">
    <div class="flex flex-col h-full min-h-0 bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-slate-200 dark:border-gray-800 overflow-hidden animate-fade-in transition-all duration-300 ease-in-out relative">
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
              <span class="mx-1 text-slate-300 dark:text-gray-600">·</span>
              <span class="text-[10px] text-slate-500 dark:text-gray-400">{{ effectiveMessageCount }} {{ languageStore.isChinese ? '条消息' : 'messages' }}</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="themeStore.toggleDarkMode()"
            :class="[
              'inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors',
              themeStore.darkMode
                ? 'bg-slate-800 text-slate-100 dark:bg-slate-700 dark:text-slate-100'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
            ]"
            :title="themeButtonText"
          >
            <Moon v-if="themeStore.darkMode" :size="14" />
            <Sun v-else :size="14" />
            <span>{{ themeButtonText }}</span>
          </button>

          <button
            @click="showSkillPanel = !showSkillPanel"
            :class="[
              'inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors',
              showSkillPanel
                ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                : 'text-slate-500 hover:text-violet-700 dark:text-gray-400 dark:hover:text-violet-300 hover:bg-slate-100 dark:hover:bg-gray-800'
            ]"
          >
            <Sparkles :size="14" />
            <span>{{ skillButtonText }}</span>
          </button>

          <button
            @click="chatStore.clearMessages"
            :disabled="!canClear"
            :class="[
              'p-2 rounded-lg transition-colors duration-200',
              canClear
                ? 'text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800'
                : 'text-slate-300 dark:text-gray-700 cursor-not-allowed'
            ]"
            :title="text.clear"
          >
            <Eraser :size="18" />
          </button>
        </div>
      </div>

      <div v-if="showSkillPanel" class="absolute top-16 right-4 z-30 w-[420px] max-w-[calc(100%-2rem)]">
        <div class="rounded-2xl border border-slate-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md shadow-xl p-2">
          <SkillPanel />
        </div>
      </div>

      <MessageList ref="messageListRef" :messages="chatStore.messages" :is-loading="chatStore.isLoading" :current-streaming-id="chatStore.currentStreamingId" @copy="handleCopy" />
      <div class="px-4 py-2 border-t border-slate-100 dark:border-gray-800 text-[11px] text-slate-400 dark:text-gray-500 bg-slate-50/60 dark:bg-gray-900/70">
        {{ inputHint }}
      </div>
      <ChatBox :is-loading="chatStore.isLoading" :placeholder="text.inputPlaceholder" @send="handleSend" @error="handleError" />
    </div>
  </div>
</template>
