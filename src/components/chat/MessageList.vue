<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { Bot, User, Sparkles, Loader2, Copy, RotateCcw } from 'lucide-vue-next';
import { useLanguageStore } from '../../stores/language.store.js';
import { useChatStore } from '../../stores/chat.store.js';
import MarkdownRenderer from './MarkdownRenderer.vue';

const props = defineProps({
  messages: { type: Array, default: () => [] },
  isLoading: Boolean,
  currentStreamingId: String,
});

const emit = defineEmits(['copy']);
const languageStore = useLanguageStore();
const chatStore = useChatStore();
const scrollerRef = ref(null);

const isStreaming = (msgId) => props.currentStreamingId === msgId;

const AUTO_SCROLL_THRESHOLD = 150;
const shouldAutoScroll = ref(true);
let isUserScrolling = false;

const formatTime = (timestamp) => languageStore.formatTime(timestamp);

const getScrollContainer = () => scrollerRef.value || null;

const isNearBottom = () => {
  const container = getScrollContainer();
  if (!container) return true;
  const { scrollTop, scrollHeight, clientHeight } = container;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  return distanceFromBottom <= AUTO_SCROLL_THRESHOLD;
};

const scrollToBottom = async (force = false) => {
  if (!force && !shouldAutoScroll.value) return;

  await nextTick();
  const container = getScrollContainer();
  if (container && props.messages.length > 0) {
    container.scrollTop = container.scrollHeight;
  }
};

const handleScroll = () => {
  const container = getScrollContainer();
  if (!container) return;

  if (isNearBottom()) {
    shouldAutoScroll.value = true;
  } else if (isUserScrolling) {
    shouldAutoScroll.value = false;
  }
};

const handleScrollStart = () => {
  isUserScrolling = true;
};

const handleScrollEnd = () => {
  isUserScrolling = false;
  handleScroll();
};

let scrollHandler = null;
let scrollStartHandler = null;
let scrollEndTimer = null;

const setupScrollListeners = () => {
  const container = getScrollContainer();
  if (!container) return;

  scrollHandler = handleScroll;
  scrollStartHandler = handleScrollStart;

  container.addEventListener('scroll', scrollHandler, { passive: true });
  container.addEventListener('wheel', scrollStartHandler, { passive: true });
  container.addEventListener('touchmove', scrollStartHandler, { passive: true });
};

const removeScrollListeners = () => {
  const container = getScrollContainer();
  if (!container) return;

  if (scrollHandler) container.removeEventListener('scroll', scrollHandler);
  if (scrollStartHandler) {
    container.removeEventListener('wheel', scrollStartHandler);
    container.removeEventListener('touchmove', scrollStartHandler);
  }
  clearTimeout(scrollEndTimer);
};

const copyMessage = (text) => navigator.clipboard.writeText(text).then(() => emit('copy', text));

const retryMessage = (msgId) => {
  chatStore.retryMessage(msgId);
};

watch(() => props.messages.length, () => {
  scrollToBottom();
});

watch(() => {
  if (props.currentStreamingId) {
    const msg = props.messages.find((item) => item.id === props.currentStreamingId);
    return msg?.text.length || 0;
  }
  return 0;
}, () => {
  scrollToBottom();
});

onMounted(() => {
  scrollToBottom(true);
  nextTick(() => setupScrollListeners());
});

onUnmounted(() => removeScrollListeners());

defineExpose({ scrollToBottom, shouldAutoScroll });
</script>

<template>
  <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
    <div
      v-if="messages.length > 0"
      ref="scrollerRef"
      class="flex-1 min-h-0 overflow-y-auto p-4 scroll-smooth"
      @scroll="handleScroll"
      @wheel="handleScrollStart"
      @touchmove="handleScrollStart"
      @touchend="handleScrollEnd"
      @mouseleave="handleScrollEnd"
    >
      <div v-for="msg in messages" :key="msg.id">
        <div v-memo="[msg.id, msg.text, msg.isError, msg.canRetry, currentStreamingId === msg.id]" :class="['flex', msg.role === 'user' ? 'justify-end' : 'justify-start', 'group', 'mb-4', 'message-item']">
          <div :class="['flex max-w-[85%] md:max-w-[75%]', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row', 'items-end gap-2']">
            <div :class="['w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm overflow-hidden', msg.role === 'user' ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-gradient-to-tr from-blue-500 to-indigo-400 text-white']">
              <User v-if="msg.role === 'user'" :size="14" class="text-blue-600 dark:text-blue-400" />
              <Sparkles v-else :size="14" />
            </div>

            <div :class="['px-5 py-3.5 shadow-sm text-sm leading-relaxed relative max-w-full overflow-hidden', msg.role === 'user' ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm' : msg.isError ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-800/50 rounded-2xl rounded-tl-sm' : 'bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 border border-slate-100 dark:border-gray-700 rounded-2xl rounded-tl-sm']">
              <button v-if="msg.role === 'user' && msg.canRetry" class="retry-btn absolute -right-2 -top-2 flex items-center gap-1 bg-orange-500 hover:bg-orange-600 text-white px-2 py-1 rounded-full text-xs shadow-lg transition-all duration-200 cursor-pointer" @click="retryMessage(msg.id)" :title="languageStore.t('chat.retry') || '重新发送'">
                <RotateCcw :size="12" />
                <span>重发</span>
              </button>
              <MarkdownRenderer v-if="msg.role === 'model' && !msg.isError" :content="msg.text" />
              <div v-if="msg.role === 'user'" class="whitespace-pre-wrap leading-relaxed">{{ msg.text }}</div>
              <div v-if="msg.isError" class="whitespace-pre-wrap leading-relaxed">{{ msg.text }}</div>
              <div :class="['flex items-center justify-end gap-2 mt-1.5', msg.role === 'user' ? 'text-blue-100' : 'text-slate-400 dark:text-gray-500']">
                <span class="text-sm opacity-60">{{ formatTime(msg.timestamp) }}</span>
                <button v-if="msg.role === 'model' && !msg.isError && msg.text" class="flex items-center gap-1 hover:text-blue-500 transition-all duration-200 cursor-pointer px-1.5 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-gray-700 text-sm opacity-60 hover:opacity-100" @click="copyMessage(msg.text)" :title="languageStore.t('chat.copyReply')"><Copy :size="14" /><span>复制</span></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-gray-500 space-y-4 opacity-50">
      <Bot :size="48" class="stroke-1" />
      <p class="text-sm">{{ languageStore.t('chat.empty') }}</p>
    </div>

    <div v-if="isLoading && !currentStreamingId" class="flex justify-start px-4 pb-4">
      <div class="flex items-center ml-10 bg-white dark:bg-gray-800 px-4 py-3 rounded-2xl rounded-tl-none border border-slate-100 dark:border-gray-700 shadow-sm">
        <Loader2 class="w-4 h-4 animate-spin text-blue-500 mr-2" />
        <span class="text-xs text-slate-500 dark:text-gray-400">{{ languageStore.t('chat.thinking') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>


.message-item {
  animation: message-slide-in 0.3s ease-out;
}

@keyframes message-slide-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

