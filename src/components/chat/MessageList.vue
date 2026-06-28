<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted, computed } from 'vue';
import { Bot, RefreshCw } from 'lucide-vue-next';
import { useLanguageStore } from '../../stores/language.store.js';
import { useChatStore } from '../../stores/chat.store.js';
import LazyMessage from './LazyMessage.vue';
import MessageBubble from './MessageBubble.vue';

// Messages older than this threshold use lazy loading
const LAZY_THRESHOLD = 5;
const shouldLazyLoad = (index) => index < props.messages.length - LAZY_THRESHOLD;

const props = defineProps({
  messages: { type: Array, default: () => [] },
  isLoading: Boolean,
  currentStreamingId: { type: String, default: '' },
});

const emit = defineEmits(['copy']);
const languageStore = useLanguageStore();
const chatStore = useChatStore();
const scrollerRef = ref(null);

const AUTO_SCROLL_THRESHOLD = 150;
const shouldAutoScroll = ref(true);
let isUserScrolling = false;

const getScrollContainer = () => scrollerRef.value || null;

const isNearBottom = () => {
  const container = getScrollContainer();
  if (!container) return true;
  const { scrollTop, scrollHeight, clientHeight } = container;
  return scrollHeight - scrollTop - clientHeight <= AUTO_SCROLL_THRESHOLD;
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
};

const handleCopy = (text) => emit('copy', text);

// Reconnection state
const reconnectProgress = computed(() => {
  if (!chatStore.isReconnecting) return 0;
  return Math.min((chatStore.reconnectAttempt / 3) * 100, 100);
});

watch(() => props.messages.length, () => {
  scrollToBottom();
});

watch(() => {
  if (props.currentStreamingId) {
    const msg = props.messages.find((item) => item.id === props.currentStreamingId);
    return [
      msg?.text?.length || 0,
      msg?.toolCalls?.length || 0,
      msg?.thinkingSteps?.length || 0,
      msg?.sources?.length || 0,
    ];
  }
  return [0, 0, 0, 0];
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
    <!-- Messages -->
    <div
      v-if="messages.length > 0"
      ref="scrollerRef"
      class="flex-1 min-h-0 overflow-y-auto p-4"
      style="scroll-behavior: auto;"
      @scroll="handleScroll"
      @wheel="handleScrollStart"
      @touchmove="handleScrollStart"
      @touchend="handleScrollEnd"
      @mouseleave="handleScrollEnd"
    >
      <TransitionGroup name="msg" tag="div">
        <div v-for="(msg, index) in messages" :key="msg.id"
          v-memo="[msg.text, msg.isError, msg.sources, msg.canRetry, msg.toolCalls?.length, msg.thinkingSteps?.length, msg.id === currentStreamingId]"
          class="mb-4">
          <LazyMessage v-if="shouldLazyLoad(index)" root-margin="400px">
            <MessageBubble :message="msg" @copy="handleCopy" />
          </LazyMessage>
          <MessageBubble v-else :message="msg" @copy="handleCopy" />
        </div>
      </TransitionGroup>
    </div>

    <!-- Skeleton: initial loading state -->
    <div v-else-if="isLoading" class="flex-1 flex flex-col p-4 space-y-6">
      <!-- AI message skeleton -->
      <div class="flex items-start gap-2">
        <div class="w-8 h-8 rounded-full skeleton-shimmer bg-slate-200 dark:bg-gray-700 shrink-0"></div>
        <div class="flex-1 space-y-2.5 bg-white dark:bg-gray-800 rounded-2xl rounded-tl-sm border border-slate-100 dark:border-gray-700 p-4">
          <div class="h-3 skeleton-shimmer bg-slate-200 dark:bg-gray-700 rounded w-3/4"></div>
          <div class="h-3 skeleton-shimmer bg-slate-200 dark:bg-gray-700 rounded w-1/2" style="animation-delay: 0.1s"></div>
          <div class="h-3 skeleton-shimmer bg-slate-200 dark:bg-gray-700 rounded w-5/6" style="animation-delay: 0.2s"></div>
        </div>
      </div>
      <!-- User message skeleton (right aligned) -->
      <div class="flex items-start gap-2 justify-end">
        <div class="space-y-2.5 bg-blue-100 dark:bg-blue-900/20 rounded-2xl rounded-tr-sm p-4 w-1/3">
          <div class="h-3 skeleton-shimmer bg-blue-200 dark:bg-blue-800/40 rounded w-full"></div>
          <div class="h-3 skeleton-shimmer bg-blue-200 dark:bg-blue-800/40 rounded w-2/3" style="animation-delay: 0.15s"></div>
        </div>
        <div class="w-8 h-8 rounded-full skeleton-shimmer bg-blue-100 dark:bg-blue-900/30 shrink-0"></div>
      </div>
      <!-- Another AI skeleton -->
      <div class="flex items-start gap-2">
        <div class="w-8 h-8 rounded-full skeleton-shimmer bg-slate-200 dark:bg-gray-700 shrink-0" style="animation-delay: 0.2s"></div>
        <div class="flex-1 space-y-2.5 bg-white dark:bg-gray-800 rounded-2xl rounded-tl-sm border border-slate-100 dark:border-gray-700 p-4">
          <div class="h-3 skeleton-shimmer bg-slate-200 dark:bg-gray-700 rounded w-2/3" style="animation-delay: 0.3s"></div>
          <div class="h-3 skeleton-shimmer bg-slate-200 dark:bg-gray-700 rounded w-4/5" style="animation-delay: 0.4s"></div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-gray-500 space-y-4 opacity-50">
      <Bot :size="48" class="stroke-1" />
      <p class="text-sm">{{ languageStore.t('chat.empty') }}</p>
    </div>

    <!-- Sending / Thinking indicator -->
    <div v-if="isLoading && messages.length > 0" class="flex justify-start px-4 pb-4">
      <div class="flex items-center ml-10 bg-white dark:bg-gray-800 px-4 py-3 rounded-2xl rounded-tl-none border border-slate-100 dark:border-gray-700 shadow-sm">
        <div class="flex items-center gap-1 mr-2">
          <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style="animation-delay: 0s"></span>
          <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style="animation-delay: 0.15s"></span>
          <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style="animation-delay: 0.3s"></span>
        </div>
        <span class="text-xs text-slate-500 dark:text-gray-400">{{ currentStreamingId ? '正在输入...' : '思考中...' }}</span>
      </div>
    </div>

    <!-- Reconnection overlay -->
    <Transition name="reconnect">
      <div v-if="chatStore.isReconnecting" class="absolute bottom-24 left-1/2 -translate-x-1/2 z-20">
        <div class="flex items-center gap-2.5 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-full px-4 py-2 shadow-lg backdrop-blur-sm">
          <RefreshCw :size="14" class="text-amber-600 dark:text-amber-400 animate-spin" />
          <span class="text-xs font-medium text-amber-700 dark:text-amber-300">
            正在重连 ({{ chatStore.reconnectAttempt }}/3)
          </span>
          <div class="w-16 h-1.5 bg-amber-200 dark:bg-amber-800 rounded-full overflow-hidden">
            <div class="h-full bg-amber-500 rounded-full transition-all duration-500" :style="{ width: reconnectProgress + '%' }"></div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* Message enter animation */
.msg-enter-active {
  transition: all 0.3s ease-out;
}

.msg-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

/* Skeleton shimmer effect */
.skeleton-shimmer {
  position: relative;
  overflow: hidden;
}

.skeleton-shimmer::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.4) 50%,
    transparent 100%
  );
  animation: shimmer 1.8s ease-in-out infinite;
}

:root.dark .skeleton-shimmer::after {
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.08) 50%,
    transparent 100%
  );
}

@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

/* Reconnection toast animation */
.reconnect-enter-active,
.reconnect-leave-active {
  transition: all 0.3s ease;
}

.reconnect-enter-from,
.reconnect-leave-to {
  opacity: 0;
  transform: translate(-50%, 20px);
}

/* Thinking dots */
@keyframes bounce {
  0%, 80%, 100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-4px);
  }
}
</style>
