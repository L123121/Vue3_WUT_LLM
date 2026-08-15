<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { User, Bot, Copy, RotateCcw, FileText, BookOpen, Tag, Hash, X, ThumbsUp, ThumbsDown, Star } from 'lucide-vue-next';
import { useLanguageStore } from '../../stores/language.store.js';
import { useChatStore } from '../../stores/chat.store.js';
import { useAuthStore } from '../../stores/auth.store.js';
import { useFavoritesStore } from '../../stores/favorites.store.js';
import { submitRagFeedback } from '../../api/rag.js';
import MarkdownRenderer from './MarkdownRenderer.vue';
import RetrievalTracePanel from './RetrievalTracePanel.vue';
import ProcessCard from './ProcessCard.vue';

const props = defineProps({
  message: {
    type: Object,
    required: true,
  },
  questionMessage: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(['copy', 'focus-input']);
const router = useRouter();
const languageStore = useLanguageStore();
const chatStore = useChatStore();
const authStore = useAuthStore();
const favoritesStore = useFavoritesStore();

const userAvatar = computed(() => authStore.user?.avatar || '');

const isUser = computed(() => props.message.role === 'user');
const isModel = computed(() => props.message.role === 'model');
const isError = computed(() => props.message.isError === true);
const canRetry = computed(() => props.message.canRetry === true);

const isStreaming = computed(() => chatStore.currentStreamingId === props.message.id);

const hasSources = computed(() => props.message.sources && props.message.sources.length > 0);
const isFallbackReply = computed(() => (
  isModel.value
  && !isError.value
  && !isStreaming.value
  && !!messageText.value
  && !hasSources.value
  && (props.message.ragTrace?.status === 'fallback'
    || props.message.ragTrace?.outcome?.fallbackReason === 'no_reliable_sources')
));
const feedbackState = ref('idle');
const selectedFeedback = computed(() => props.message.feedback?.rating || '');
const isRagAnswer = computed(() => (
  isModel.value
  && !isError.value
  && !!messageText.value
  && !isStreaming.value
  && (props.message.usedRag === true || props.message.answerMode === 'rag' || hasSources.value)
));

// V2.0 自动路由徽标：后端意图识别结果 → 中文标签
const intentLabel = computed(() => {
  const route = props.message.intent?.route;
  const map = {
    rag: '自动路由：知识库检索',
    chat: '自动路由：普通对话',
    agent: '自动路由：多步任务',
  };
  return map[route] || '';
});
const showIntentBadge = computed(() => isModel.value && !isError.value && !!intentLabel.value);

// L2 工具调度可视化：message.toolCalls/toolResults（useStreaming onToolCall/onToolResult 写入）
const toolCalls = computed(() => props.message.toolCalls || []);
const toolResults = computed(() => props.message.toolResults || []);
const showToolPanel = computed(() => toolCalls.value.length > 0);
const toolPanelOpen = ref(false);
const toolResultText = (name) => {
  const r = toolResults.value.find((tr) => tr.name === name);
  if (!r) return '执行中...';
  const text = String(r.content || '').replace(/\s+/g, ' ').trim();
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
};

// Agent L4 trace 元信息：rounds / finishReason / totalMs（随 SSE trace 事件写入 ragTrace）
const agentTrace = computed(() => {
  const t = props.message.ragTrace;
  // agent trace 以 finishReason 字段为标志（RAG trace 无此字段）
  return t && typeof t.finishReason === 'string' ? t : null;
});
const finishReasonLabel = computed(() => {
  if (!agentTrace.value) return '';
  const map = {
    direct_answer: '直接回答',
    round_limit: '达到轮次上限',
    no_progress: '无进展强制收尾',
    error: '出错收尾',
  };
  return map[agentTrace.value.finishReason] || agentTrace.value.finishReason;
});
const formatAgentTotalMs = (ms) => {
  const s = Number(ms) / 1000;
  return s >= 10 ? `${s.toFixed(0)}s` : `${s.toFixed(1)}s`;
};
const questionText = computed(() => props.questionMessage?.content ?? props.questionMessage?.text ?? '');

// 行内引用弹窗
const citationPopup = ref(null); // { source: {...}, index: number } | null
const showCitation = (index) => {
  const sources = props.message.sources || [];
  const source = sources[index - 1];
  if (source) {
    citationPopup.value = { source, index };
  }
};
const closeCitation = () => { citationPopup.value = null; };

// 跳转到知识库查看原文（复用 KnowledgeBase 的 docId 自动预览 + q 高亮）
const openSourceInKnowledgeBase = () => {
  const source = citationPopup.value?.source;
  if (!source) return;
  const docId = source.id || source.docId || source.parentId;
  if (!docId) return;
  // 用 snippet 中的首个有意义的词作为高亮关键词，提升定位精度
  const snippet = source.snippet || '';
  const match = snippet.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}/);
  const q = match ? match[0] : '';
  closeCitation();
  router.push({ path: '/knowledge', query: { docId, ...(q ? { q } : {}) } });
};

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
  navigator.clipboard.writeText(text)
    .then(() => emit('copy', text))
    .catch(() => emit('copy', text)); // 复制失败也通知外层（toast 兜底）
};

// 收藏/取消收藏消息
const isFavorited = computed(() => favoritesStore.isFavorite(props.message.id));
const toggleFavorite = () => {
  favoritesStore.toggleFavorite(props.message, chatStore.currentConversation);
};

const buildFeedbackSources = () => (props.message.sources || []).map((source) => ({
  id: source.id || source.parentId || source.docId || '',
  title: source.title || '',
  category: source.category || '',
  score: source.score ?? source.maxScore ?? null,
}));

const submitFeedback = async (rating) => {
  if (!isRagAnswer.value || feedbackState.value === 'submitting') return;
  if (selectedFeedback.value === rating) return;

  feedbackState.value = 'submitting';
  try {
    const submittedAt = new Date().toISOString();
    await submitRagFeedback({
      rating,
      messageId: props.message.id,
      conversationId: chatStore.currentConversationId,
      questionMessageId: props.questionMessage?.id || '',
      question: questionText.value,
      answer: messageText.value,
      traceId: props.message.traceId || props.message.ragTrace?.traceId || '',
      sources: buildFeedbackSources(),
    });
    chatStore.setMessageFeedback(props.message.id, { rating, submittedAt });
    feedbackState.value = 'done';
  } catch (error) {
    console.error('[RAG Feedback] 提交失败:', error);
    feedbackState.value = 'error';
  }
};

const feedbackButtonClasses = (rating) => {
  const isActive = selectedFeedback.value === rating;
  const activeClasses = rating === 'like'
    ? 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700'
    : 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-700';

  return [
    'inline-flex h-7 w-7 items-center justify-center rounded-full border transition-all duration-200 disabled:cursor-wait disabled:opacity-60',
    isActive
      ? activeClasses
      : 'border-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200',
  ];
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

        <!-- Message text -->
        <MarkdownRenderer v-if="isModel && !isError" :content="messageText" :sources="message.sources || []" @citation-click="showCitation" @copy-code="(code) => copyMessage(code)" />
        <div v-if="isUser || isError" class="whitespace-pre-wrap leading-relaxed">{{ messageText }}</div>

        <!-- 政策问答步骤卡片（后端解析的结构化 JSON） -->
        <ProcessCard v-if="isModel && !isError && message.processCard" :card="message.processCard" />

        <!-- V2.0 自动路由徽标：后端意图识别结果（替代原手动 RAG 开关） -->
        <div v-if="showIntentBadge" class="mt-2 inline-flex items-center gap-1 rounded-full bg-blue-50/80 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 px-2 py-0.5">
          <span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
          <span class="text-[10px] font-medium text-blue-600 dark:text-blue-300">{{ intentLabel }}</span>
        </div>

        <!-- L2 工具调度卡片：展示 tool_call / tool_result（Agent 路径透明化） -->
        <div v-if="isModel && !isError && showToolPanel" class="mt-2 rounded-xl border border-indigo-100 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20 overflow-hidden">
          <button
            type="button"
            class="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100/50 dark:hover:bg-indigo-900/20 transition-colors"
            @click="toolPanelOpen = !toolPanelOpen"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
            <span>工具调用 {{ toolCalls.length }} 次</span>
            <span class="ml-auto text-indigo-400 dark:text-indigo-500 transition-transform" :class="toolPanelOpen ? 'rotate-180' : ''">▾</span>
          </button>
          <div v-if="toolPanelOpen" class="px-3 pb-3 space-y-2">
            <!-- Agent L4 trace 元信息：轮次 / 收尾原因 / 总耗时 -->
            <div v-if="agentTrace" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 dark:text-gray-400">
              <span class="inline-flex items-center gap-1">
                <span class="font-medium text-indigo-500 dark:text-indigo-400">轮次</span>
                <span class="font-mono">{{ agentTrace.rounds ?? 0 }}</span>
              </span>
              <span class="inline-flex items-center gap-1">
                <span class="font-medium text-indigo-500 dark:text-indigo-400">收尾</span>
                <span>{{ finishReasonLabel }}</span>
              </span>
              <span class="inline-flex items-center gap-1">
                <span class="font-medium text-indigo-500 dark:text-indigo-400">耗时</span>
                <span class="font-mono">{{ formatAgentTotalMs(agentTrace.totalMs) }}</span>
              </span>
            </div>
            <div v-for="(tc, i) in toolCalls" :key="i" class="rounded-lg bg-white/70 dark:bg-gray-900/40 border border-indigo-100/70 dark:border-indigo-900/40 px-2.5 py-2">
              <div class="flex items-center gap-2 text-[11px]">
                <span class="font-mono font-semibold text-indigo-700 dark:text-indigo-300">{{ tc.name }}</span>
                <span class="ml-auto text-slate-400 dark:text-gray-500">
                  {{ tc.arguments && Object.keys(tc.arguments).length ? JSON.stringify(tc.arguments).slice(0, 60) : '无参数' }}
                </span>
              </div>
              <div class="mt-1 text-[11px] text-slate-600 dark:text-gray-400 leading-relaxed break-all">{{ toolResultText(tc.name) }}</div>
            </div>
          </div>
        </div>

        <!-- 检索过程可视化（RAG 回答） -->
        <RetrievalTracePanel v-if="isModel && !isError && message.ragTrace" :trace="message.ragTrace" />

        <!-- 拒答引导：无可靠来源时给出建议操作 -->
        <div v-if="isFallbackReply" class="mt-3 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/20 p-3">
          <p class="text-xs font-medium text-amber-800 dark:text-amber-300">没有检索到足够可靠的资料</p>
          <p class="mt-1 text-xs text-amber-700/80 dark:text-amber-400/80 leading-relaxed">
            可以换个问法（更具体、包含更多关键词），或去知识库查看相关文档后再提问。
          </p>
          <div class="mt-2 flex items-center gap-2">
            <button
              @click="emit('focus-input')"
              class="inline-flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 transition-colors"
            >
              <RotateCcw :size="12" />
              换个问法
            </button>
            <button
              @click="router.push('/knowledge')"
              class="inline-flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
            >
              <BookOpen :size="12" />
              去知识库
            </button>
          </div>
        </div>

        <!-- 行内引用弹窗 -->
        <Teleport to="body">
          <Transition name="popup">
            <div v-if="citationPopup" class="fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="closeCitation">
              <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="closeCitation"></div>
              <div class="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-gray-700 max-w-lg w-full max-h-[60vh] overflow-hidden flex flex-col">
                <!-- Header -->
                <div class="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-gray-800 shrink-0">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-xs font-bold shrink-0">{{ citationPopup.index }}</span>
                    <div class="min-w-0">
                      <span class="text-sm font-semibold text-slate-800 dark:text-white truncate block">{{ citationPopup.source.title }}</span>
                      <span v-if="citationPopup.source.category" class="text-[10px] text-slate-500 dark:text-gray-400">{{ citationPopup.source.category }}</span>
                    </div>
                  </div>
                  <button @click="closeCitation" class="shrink-0 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 transition-colors cursor-pointer">
                    <X :size="16" />
                  </button>
                </div>
                <!-- Content -->
                <div class="p-5 overflow-y-auto flex-1">
                  <MarkdownRenderer :content="citationPopup.source.snippet || '（无原文内容）'" :sources="[]" />
                </div>
                <!-- Footer: 跳转知识库查看原文 -->
                <div class="px-5 py-3 border-t border-slate-100 dark:border-gray-800 shrink-0">
                  <button
                    @click="openSourceInKnowledgeBase"
                    class="w-full h-9 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    <BookOpen :size="13" />
                    在知识库查看原文
                  </button>
                </div>
              </div>
            </div>
          </Transition>
        </Teleport>

        <!-- 流式状态指示器 -->
        <div v-if="isStreaming && isModel && !messageText" class="flex items-center gap-1.5 mt-1">
          <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style="animation-delay: 0s"></span>
          <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style="animation-delay: 0.15s"></span>
          <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style="animation-delay: 0.3s"></span>
          <span class="text-xs text-slate-500 dark:text-gray-400 ml-0.5">思考中...</span>
        </div>

        <!-- Footer with time and actions -->
        <div :class="['flex items-center justify-end gap-2 mt-1.5', timeClasses]">
          <span class="text-sm opacity-60">{{ formatTime(message.timestamp) }}</span>
          <div v-if="isRagAnswer" class="flex items-center gap-1 rounded-full bg-slate-50/80 dark:bg-gray-900/40 px-1 py-0.5" aria-label="RAG 回答评价">
            <button
              type="button"
              :class="feedbackButtonClasses('like')"
              :disabled="feedbackState === 'submitting'"
              :aria-pressed="selectedFeedback === 'like'"
              title="回答有帮助"
              @click="submitFeedback('like')"
            >
              <ThumbsUp :size="14" :class="{ 'fill-current': selectedFeedback === 'like' }" />
            </button>
            <button
              type="button"
              :class="feedbackButtonClasses('dislike')"
              :disabled="feedbackState === 'submitting'"
              :aria-pressed="selectedFeedback === 'dislike'"
              title="回答需改进"
              @click="submitFeedback('dislike')"
            >
              <ThumbsDown :size="14" :class="{ 'fill-current': selectedFeedback === 'dislike' }" />
            </button>
          </div>
          <span v-if="isRagAnswer && (selectedFeedback || feedbackState === 'done')" class="text-xs opacity-60">已反馈</span>
          <span v-else-if="isRagAnswer && feedbackState === 'error'" class="text-xs text-red-400 dark:text-red-300">提交失败</span>
          <button
            v-if="isModel && !isError && messageText"
            class="flex items-center gap-1 hover:text-blue-500 transition-all duration-200 cursor-pointer px-1.5 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-gray-700 text-sm opacity-60 hover:opacity-100"
            @click="copyMessage(messageText)"
            :title="languageStore.t('chat.copyReply')"
          >
            <Copy :size="14" />
            <span>复制</span>
          </button>
          <button
            v-if="messageText && !isStreaming"
            class="flex items-center gap-1 transition-all duration-200 cursor-pointer px-1.5 py-0.5 rounded text-sm"
            :class="isFavorited
              ? 'text-amber-500 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
              : 'text-slate-400 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 opacity-60 hover:opacity-100'"
            @click="toggleFavorite"
            :title="isFavorited ? '取消收藏' : '收藏此消息'"
          >
            <Star :size="14" :class="{ 'fill-current': isFavorited }" />
            <span v-if="isFavorited">已收藏</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 引用弹窗动画 */
.popup-enter-active { transition: all 0.2s ease-out; }
.popup-leave-active { transition: all 0.15s ease-in; }
.popup-enter-from { opacity: 0; }
.popup-enter-from > div:last-child { transform: scale(0.95) translateY(10px); }
.popup-leave-to { opacity: 0; }
.popup-leave-to > div:last-child { transform: scale(0.95); }

/* 行内引用深色模式 */
:deep(.citation:hover) {
  background: #c7d2fe !important;
  box-shadow: 0 1px 3px rgba(79, 70, 229, 0.3);
}
:root.dark :deep(.citation) {
  background: #1e1b4b !important;
  color: #a5b4fc !important;
  border-color: #312e81 !important;
}
:root.dark :deep(.citation:hover) {
  background: #312e81 !important;
  box-shadow: 0 1px 3px rgba(99, 102, 241, 0.3);
}
</style>
