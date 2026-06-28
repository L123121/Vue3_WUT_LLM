<script setup>
import { computed } from 'vue';
import { User, Bot, Copy, RotateCcw, FileText, BookOpen, Tag, Hash } from 'lucide-vue-next';
import { useLanguageStore } from '../../stores/language.store.js';
import { useChatStore } from '../../stores/chat.store.js';
import { useAuthStore } from '../../stores/auth.store.js';
import MarkdownRenderer from './MarkdownRenderer.vue';
import AgentThinking from './AgentThinking.vue';
import AgentToolCall from './AgentToolCall.vue';

const props = defineProps({
  message: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['copy']);
const languageStore = useLanguageStore();
const chatStore = useChatStore();
const authStore = useAuthStore();

const userAvatar = computed(() => authStore.user?.avatar || '');

const isUser = computed(() => props.message.role === 'user');
const isModel = computed(() => props.message.role === 'model');
const isError = computed(() => props.message.isError === true);
const canRetry = computed(() => props.message.canRetry === true);

const hasAgentData = computed(() =>
  (props.message.toolCalls?.length > 0) || (props.message.thinkingSteps?.length > 0)
);

// 使用 store 维护的 _timeline（精确事件顺序）
const timeline = computed(() => {
  const rawTimeline = props.message._timeline || [];

  return rawTimeline.map((evt, i) => {
    const isLast = i === rawTimeline.length - 1;
    if (evt.type === 'tool') {
      const tc = (props.message.toolCalls || []).find(t => t.id === evt.id);
      return { ...evt, status: tc?.status || 'running', result: tc?.result || '', arguments: tc?.arguments, isLast };
    }
    return { ...evt, isLast, id: `evt_${i}` };
  });
});

const isStreaming = computed(() => chatStore.currentStreamingId === props.message.id);

const hasSources = computed(() => props.message.sources && props.message.sources.length > 0);

const messageText = computed(() => props.message.content ?? props.message.text ?? '');

const isParentChildSource = (source) => {
  return source.chunkCount !== undefined || source.category !== undefined || source.matchedChunks !== undefined;
};

const getCategoryColor = (category) => {
  const colors = {
    '学术': 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
    '教务': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400',
    '校园': 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400',
    '技术': 'bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400',
    'general': 'bg-slate-100 text-slate-600 dark:bg-gray-700 dark:text-gray-400',
  };
  return colors[category] || colors['general'];
};

const formatTime = (timestamp) => languageStore.formatTime(timestamp);

const copyMessage = (text) => {
  navigator.clipboard.writeText(text).then(() => emit('copy', text));
};

const retryMessage = (msgId) => {
  chatStore.retryMessage(msgId);
};

const openImage = (url) => {
  window.open(url, '_blank');
};

const onAvatarError = (e) => {
  e.target.style.display = 'none';
};

const bubbleClasses = computed(() => {
  if (isUser.value) {
    return 'bg-blue-600 text-white rounded-2xl rounded-tr-sm';
  }
  if (isError.value) {
    return 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-800/50 rounded-2xl rounded-tl-sm';
  }
  return 'bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 border border-slate-100 dark:border-gray-700 rounded-2xl rounded-tl-sm';
});

const avatarClasses = computed(() => {
  if (isUser.value) {
    return 'bg-blue-100 dark:bg-blue-900/30';
  }
  return 'bg-gradient-to-tr from-blue-500 to-indigo-400 shadow-blue-500/30';
});

const timeClasses = computed(() => {
  return isUser.value ? 'text-blue-100' : 'text-slate-400 dark:text-gray-500';
});
</script>

<template>
  <div :class="['flex', isUser ? 'justify-end' : 'justify-start', 'group']">
    <div :class="['flex max-w-[85%] md:max-w-[75%]', isUser ? 'flex-row-reverse' : 'flex-row', 'items-start gap-2']">
      <!-- Avatar -->
      <div :class="['w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm overflow-hidden', avatarClasses]">
        <img v-if="isUser && userAvatar" :src="userAvatar" alt="用户头像" class="w-full h-full object-cover bg-white" @error="onAvatarError" />
        <User v-if="isUser && !userAvatar" :size="14" class="text-blue-600 dark:text-blue-400" />
        <Bot v-else :size="15" class="text-white" />
      </div>

      <!-- Message content -->
      <div :class="['px-5 py-3.5 shadow-sm text-sm leading-relaxed relative max-w-full overflow-hidden', bubbleClasses]">
        <!-- Retry button for user messages -->
        <button
          v-if="isUser && canRetry"
          class="retry-btn absolute -right-2 -top-2 flex items-center gap-1 bg-orange-500 hover:bg-orange-600 text-white px-2 py-1 rounded-full text-xs shadow-lg transition-all duration-200 cursor-pointer"
          @click="retryMessage(message.id)"
          :title="languageStore.t('chat.retry') || '重新发送'"
        >
          <RotateCcw :size="12" />
          <span>重发</span>
        </button>

        <!-- File attachments -->
        <div v-if="message.files?.length" class="space-y-1.5 mb-2">
          <div
            v-for="file in message.files" :key="file.url"
            class="flex items-center gap-2 p-2 rounded-lg"
            :class="isUser ? 'bg-blue-500/20' : 'bg-slate-100 dark:bg-gray-700/50'"
          >
            <img
              v-if="file.isImage" :src="file.url"
              class="max-w-[200px] max-h-[200px] rounded-lg object-contain cursor-pointer hover:opacity-90 transition-opacity"
              @click="openImage(file.url)"
              loading="lazy"
            />
            <a
              v-else :href="file.url" target="_blank"
              class="flex items-center gap-2 text-xs hover:underline"
              :class="isUser ? 'text-white/80 hover:text-white' : 'text-blue-600 dark:text-blue-400'"
            >
              <span class="text-slate-400 shrink-0"><FileText :size="14" /></span>
              <span class="truncate max-w-[150px]">{{ file.name }}</span>
            </a>
          </div>
        </div>

        <!-- Agent 时间线（思考 + 工具调用按顺序混排，放在回答上方） -->
        <div v-if="hasAgentData && isModel" class="mb-3 space-y-1.5">
          <template v-for="event in timeline" :key="event.id">
            <AgentThinking v-if="event.type === 'thinking'" :step="event" :has-reply="!!messageText" />
            <AgentToolCall v-if="event.type === 'tool'" :tool-call="event" />
          </template>
        </div>

        <!-- Message text -->
        <MarkdownRenderer v-if="isModel && !isError" :content="messageText" />
        <div v-if="isUser || isError" class="whitespace-pre-wrap leading-relaxed">{{ messageText }}</div>

        <!-- RAG 知识库引用来源 -->
        <div v-if="hasSources && isModel" class="mt-3 border-t border-slate-100 dark:border-gray-700 pt-2.5">
          <div class="flex items-center gap-1.5 mb-2">
            <BookOpen :size="12" class="text-indigo-500 dark:text-indigo-400" />
            <span class="text-[10px] font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider">知识库引用</span>
            <span class="text-[10px] text-slate-400 dark:text-gray-600 font-mono">{{ message.sources.length }} 篇文档</span>
          </div>
          <div class="space-y-1.5">
            <div
              v-for="source in message.sources"
              :key="source.id"
              class="flex items-center gap-2 p-2 rounded-lg bg-slate-50/80 dark:bg-gray-700/40 border border-slate-100 dark:border-gray-600/50"
            >
              <FileText :size="13" class="text-indigo-400 dark:text-indigo-500 shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="text-xs font-medium text-slate-700 dark:text-gray-200 truncate">{{ source.title }}</span>
                  <span
                    v-if="source.category"
                    class="shrink-0 text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                    :class="getCategoryColor(source.category)"
                  >
                    <Tag :size="9" class="inline mr-0.5" />{{ source.category }}
                  </span>
                </div>
                <div class="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400 dark:text-gray-500">
                  <span v-if="source.chunkCount" class="flex items-center gap-0.5">
                    <Hash :size="9" /> {{ source.chunkCount }} 段
                  </span>
                  <span v-if="source.matchedChunks" class="flex items-center gap-0.5 text-indigo-500">
                    匹配 {{ source.matchedChunks }} 段
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 流式状态指示器 -->
        <div v-if="isStreaming && isModel && !messageText && !hasAgentData" class="flex items-center gap-1.5 mt-1">
          <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style="animation-delay: 0s"></span>
          <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style="animation-delay: 0.15s"></span>
          <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style="animation-delay: 0.3s"></span>
        </div>

        <!-- Footer with time and actions -->
        <div :class="['flex items-center justify-end gap-2 mt-1.5', timeClasses]">
          <span class="text-sm opacity-60">{{ formatTime(message.timestamp) }}</span>
          <button
            v-if="isModel && !isError && messageText"
            class="flex items-center gap-1 hover:text-blue-500 transition-all duration-200 cursor-pointer px-1.5 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-gray-700 text-sm opacity-60 hover:opacity-100"
            @click="copyMessage(messageText)"
            :title="languageStore.t('chat.copyReply')"
          >
            <Copy :size="14" />
            <span>复制</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
