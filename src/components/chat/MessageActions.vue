<script setup>
import { ref, computed } from 'vue';
import { Copy, Star, Volume2, Square, Loader2, ThumbsUp, ThumbsDown, GitFork, Pencil } from 'lucide-vue-next';
import { useConversationStore } from '../../stores/conversation.store.js';
import { useMessageStore } from '../../stores/message.store.js';
import { useFavoritesStore } from '../../stores/favorites.store.js';
import { useToastStore } from '../../stores/toast.store.js';
import { useSpeechPlayer } from '../../composables/useSpeechPlayer.js';
import { submitRagFeedback } from '../../api/rag.js';
import { forkConversation } from '../../api/conversations.js';

/**
 * 消息 footer 操作行：时间 / RAG 反馈（点赞点踩）/ 朗读 / 复制 / 收藏 / 编辑 / 分叉。
 * 反馈、语音、分叉的逻辑内聚在本组件；编辑按钮只发事件（编辑态在气泡正文内）。
 */

const props = defineProps({
  message: { type: Object, required: true },
  questionMessage: { type: Object, default: null },
  messageText: { type: String, default: '' },
  isUser: Boolean,
  isModel: Boolean,
  isError: Boolean,
  isStreaming: Boolean,
  timeClasses: { type: String, default: '' },
  editing: Boolean,
});

const emit = defineEmits(['copy', 'start-edit']);

const conversationStore = useConversationStore();
const messageStore = useMessageStore();
const favoritesStore = useFavoritesStore();
const toast = useToastStore();
const speechPlayer = useSpeechPlayer();

// ===== RAG 回答反馈（点赞/点踩 → /api/rag/feedback） =====
const feedbackState = ref('idle');
const selectedFeedback = computed(() => props.message.feedback?.rating || '');
const isRagAnswer = computed(() => (
  props.isModel
  && !props.isError
  && !!props.messageText
  && !props.isStreaming
  && (props.message.usedRag === true || props.message.answerMode === 'rag' || (props.message.sources?.length > 0))
));

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
      conversationId: conversationStore.currentConversationId,
      questionMessageId: props.questionMessage?.id || '',
      question: props.questionMessage?.content ?? props.questionMessage?.text ?? '',
      answer: props.messageText,
      traceId: props.message.traceId || props.message.ragTrace?.traceId || '',
      sources: buildFeedbackSources(),
    });
    messageStore.setMessageFeedback(props.message.id, { rating, submittedAt });
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

// ===== 语音朗读 =====
const isSpeechActive = computed(() => speechPlayer.activeMessageId.value === props.message.id);
const isSpeechLoading = computed(() => isSpeechActive.value && speechPlayer.isLoading.value);
const speechProgress = computed(() => {
  if (!isSpeechActive.value || speechPlayer.chunkCount.value <= 1) return '';
  return `${speechPlayer.chunkIndex.value}/${speechPlayer.chunkCount.value}`;
});

const toggleSpeech = async () => {
  try {
    const result = await speechPlayer.play(props.message.id, props.messageText);
    if (result?.fallback) toast.warning('语音服务额度已耗尽，正在使用浏览器本地朗读');
    if (result?.truncated) toast.warning('回答较长，本次仅朗读前 4000 字');
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.error('[Speech] 播放失败:', error);
    toast.error(error?.message || '语音播放失败，请稍后重试');
  }
};

// ===== 复制 / 收藏 =====
const copyMessage = (text) => {
  navigator.clipboard.writeText(text)
    .then(() => emit('copy', text))
    .catch(() => emit('copy', text)); // 复制失败也通知外层（toast 兜底）
};

const isFavorited = computed(() => favoritesStore.isFavorite(props.message.id));
const toggleFavorite = () => {
  favoritesStore.toggleFavorite(props.message, conversationStore.currentConversation);
};

// ===== 分叉：复制当前消息（含）之前的历史到新会话 =====
const forkLoading = ref(false);
const forkFromHere = async () => {
  const conv = conversationStore.currentConversation;
  if (!conv || forkLoading.value || messageStore.isLoading) return;
  forkLoading.value = true;
  try {
    const res = await forkConversation(conv.id, props.message.id);
    if (!res?.success || !res?.data?.id) throw new Error(res?.error || '分叉失败');
    const newId = conversationStore.importForkedConversation(res.data);
    if (newId && newId !== conversationStore.currentConversationId) {
      await conversationStore.switchConversation(newId);
    }
    toast.success('已分叉出新会话，原会话保持不变');
  } catch (error) {
    toast.error(error.message || '分叉失败，请重试');
  } finally {
    forkLoading.value = false;
  }
};

const formatTime = (timestamp) =>
  new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
</script>

<template>
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
      class="flex items-center gap-1 hover:text-wut-500 transition-all duration-200 cursor-pointer px-1.5 py-0.5 rounded hover:bg-wut-50 dark:hover:bg-gray-700 text-sm opacity-60 hover:opacity-100"
      @click="toggleSpeech"
      :title="isSpeechActive ? '停止朗读' : '朗读回答'"
      :aria-label="isSpeechActive ? '停止朗读' : '朗读回答'"
    >
      <Loader2 v-if="isSpeechLoading" :size="14" class="animate-spin" />
      <Square v-else-if="isSpeechActive" :size="13" class="fill-current" />
      <Volume2 v-else :size="14" />
      <span>{{ isSpeechLoading ? `生成中${speechProgress ? ` ${speechProgress}` : ''}` : (isSpeechActive ? `停止${speechProgress ? ` ${speechProgress}` : ''}` : '朗读') }}</span>
    </button>

    <button
      v-if="isModel && !isError && messageText"
      class="flex items-center gap-1 hover:text-wut-500 transition-all duration-200 cursor-pointer px-1.5 py-0.5 rounded hover:bg-wut-50 dark:hover:bg-gray-700 text-sm opacity-60 hover:opacity-100"
      @click="copyMessage(messageText)"
      title="复制回复"
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

    <button
      v-if="isUser && !isStreaming && !editing"
      class="flex items-center gap-1 hover:text-wut-500 transition-all duration-200 cursor-pointer px-1.5 py-0.5 rounded text-sm opacity-60 hover:opacity-100"
      :class="timeClasses"
      @click="emit('start-edit')"
      title="编辑此消息并重新发送"
    >
      <Pencil :size="14" />
    </button>

    <button
      v-if="messageText && !isStreaming"
      :disabled="forkLoading || messageStore.isLoading"
      class="flex items-center gap-1 hover:text-wut-500 transition-all duration-200 cursor-pointer px-1.5 py-0.5 rounded text-sm disabled:opacity-50"
      :class="timeClasses"
      @click="forkFromHere"
      title="从此处分叉出新会话（原会话保持不变）"
    >
      <GitFork :size="14" />
    </button>
  </div>
</template>
