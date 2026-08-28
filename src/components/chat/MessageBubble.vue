<script setup>
import { ref, computed, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { User, Bot, RotateCcw, FileText, BookOpen } from 'lucide-vue-next';
import { useLanguageStore } from '../../stores/language.store.js';
import { useChatStore } from '../../stores/chat.store.js';
import { useAuthStore } from '../../stores/auth.store.js';
import MarkdownRenderer from './MarkdownRenderer.vue';
import RetrievalTracePanel from './RetrievalTracePanel.vue';
import ProcessCard from './ProcessCard.vue';
import MessageActions from './MessageActions.vue';
import AgentToolPanel from './AgentToolPanel.vue';
import CitationPopup from './CitationPopup.vue';

/**
 * 单条消息气泡：容器/头像/正文渲染 + 徽标（路由、溯源、用量、追问）+ 编辑态。
 * 交互动作（反馈/语音/复制/收藏/分叉）拆至 MessageActions，
 * 工具面板拆至 AgentToolPanel，引用弹窗拆至 CitationPopup。
 */

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

// 运行时引用校验徽标：后端逐句对照 RAG 上下文得出溯源覆盖率（grounding SSE 事件写入）
const grounding = computed(() => props.message.grounding || null);
const showGroundingBadge = computed(() => (
  isModel.value && !isError.value && !isStreaming.value && !!grounding.value
));
const groundingLabel = computed(() => {
  const g = grounding.value;
  if (!g) return '';
  const pct = Math.round(g.coverage * 100);
  const levelMap = { high: '溯源良好', medium: '部分溯源', low: '低溯源' };
  return `已溯源 ${pct}% · ${levelMap[g.level] || g.level}`;
});
const groundingBadgeClass = computed(() => {
  const level = grounding.value?.level;
  if (level === 'high') {
    return 'bg-emerald-50/80 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800/40 text-emerald-600 dark:text-emerald-300';
  }
  if (level === 'medium') {
    return 'bg-amber-50/80 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800/40 text-amber-600 dark:text-amber-300';
  }
  return 'bg-red-50/80 dark:bg-red-900/20 border-red-100 dark:border-red-800/40 text-red-600 dark:text-red-300';
});

// token 用量（usage SSE 事件 / 非流式结果写入）：OpenAI 兼容口径 prompt_tokens / completion_tokens
const usageLabel = computed(() => {
  const usage = props.message.usage;
  if (!usage) return '';
  const prompt = usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens;
  const completion = usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens;
  if (!Number.isFinite(Number(prompt)) && !Number.isFinite(Number(completion))) return '';
  const total = usage.total_tokens ?? (Number(prompt || 0) + Number(completion || 0));
  const parts = [];
  if (Number.isFinite(Number(prompt))) parts.push(`输入 ${prompt}`);
  if (Number.isFinite(Number(completion))) parts.push(`输出 ${completion}`);
  if (Number.isFinite(Number(total))) parts.push(`共 ${total}`);
  return `${parts.join(' · ')} tokens`;
});

// 追问建议（followups SSE 事件写入）：点击直接发起提问
const followups = computed(() => (Array.isArray(props.message.followups) ? props.message.followups : []));
const sendFollowup = (text) => {
  if (!text || chatStore.isLoading) return;
  chatStore.sendMessage(text);
};

// Agent 工具面板的透传数据（面板内部状态由 AgentToolPanel 自管）
const toolCalls = computed(() => props.message.toolCalls || []);
const toolResults = computed(() => props.message.toolResults || []);
const agentTrace = computed(() => {
  const t = props.message.ragTrace;
  // agent trace 以 finishReason 字段为标志（RAG trace 无此字段）
  return t && typeof t.finishReason === 'string' ? t : null;
});

// 行内引用弹窗：状态在父级（依赖 message.sources），弹窗本体拆至 CitationPopup
const citationPopup = ref(null); // { source: {...}, index: number } | null
const showCitation = (index) => {
  const sources = props.message.sources || [];
  const source = sources[index - 1];
  if (source) {
    citationPopup.value = { source, index };
  }
};

const messageText = computed(() => props.message.content ?? props.message.text ?? '');

const copyCode = (code) => {
  navigator.clipboard.writeText(code)
    .then(() => emit('copy', code))
    .catch(() => emit('copy', code)); // 复制失败也通知外层（toast 兜底）
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
    return 'bg-wut-600 text-white rounded-2xl rounded-tr-sm';
  }
  if (isError.value) {
    return 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-800/50 rounded-2xl rounded-tl-sm';
  }
  return 'bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 border border-slate-100 dark:border-gray-700 rounded-2xl rounded-tl-sm';
});

const avatarClasses = computed(() => {
  if (isUser.value) {
    return 'bg-wut-100 dark:bg-wut-900/30';
  }
  return 'bg-wut-600 shadow-wut-500/30';
});

const timeClasses = computed(() => {
  return isUser.value ? 'text-wut-100' : 'text-slate-400 dark:text-gray-500';
});

// ===== 用户消息编辑重发 =====
const editing = ref(false);
const editText = ref('');
const editTextareaRef = ref(null);
const startEdit = () => {
  if (chatStore.isLoading) return;
  editText.value = messageText.value;
  editing.value = true;
  nextTick(() => editTextareaRef.value?.focus());
};
const cancelEdit = () => {
  editing.value = false;
};
const saveEdit = async () => {
  const text = editText.value.trim();
  if (!text || chatStore.isLoading) return;
  editing.value = false;
  await chatStore.editAndResendMessage(props.message.id, text);
};
</script>

<template>
  <div :class="['flex', isUser ? 'justify-end' : 'justify-start', 'group']">
    <div :class="['flex max-w-[85%] md:max-w-[75%]', isUser ? 'flex-row-reverse' : 'flex-row', 'items-start gap-2']">
      <!-- Avatar -->
      <div :class="['w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm overflow-hidden', avatarClasses]">
        <img v-if="isUser && userAvatar" :src="userAvatar" alt="用户头像" class="w-full h-full object-cover bg-white" @error="onAvatarError" />
        <User v-if="isUser && !userAvatar" :size="14" class="text-wut-600 dark:text-wut-400" />
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
            :class="isUser ? 'bg-wut-500/20' : 'bg-slate-100 dark:bg-gray-700/50'"
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
              :class="isUser ? 'text-white/80 hover:text-white' : 'text-wut-600 dark:text-wut-400'"
            >
              <span class="text-slate-400 shrink-0"><FileText :size="14" /></span>
              <span class="truncate max-w-[150px]">{{ file.name }}</span>
            </a>
          </div>
        </div>

        <!-- Message text -->
        <MarkdownRenderer v-if="isModel && !isError" :content="messageText" :sources="message.sources || []" @citation-click="showCitation" @copy-code="copyCode" />

        <!-- 用户消息编辑态：修改后重发（复用 retry 通道，替换原回复） -->
        <div v-if="isUser && editing" class="w-full min-w-[220px]">
          <textarea
            ref="editTextareaRef"
            v-model="editText"
            rows="3"
            class="w-full rounded-lg border border-wut-200 dark:border-wut-700 bg-white dark:bg-gray-800 text-slate-800 dark:text-gray-100 text-sm p-2 outline-none focus:ring-2 focus:ring-wut-300 dark:focus:ring-wut-800 resize-y"
            @keydown.enter.exact.prevent="saveEdit"
            @keydown.esc.prevent="cancelEdit"
          ></textarea>
          <div class="mt-1.5 flex items-center justify-end gap-2">
            <button
              type="button"
              class="px-2.5 py-1 rounded-lg text-xs text-slate-500 dark:text-gray-400 hover:bg-white/15 transition-colors"
              @click="cancelEdit"
            >取消</button>
            <button
              type="button"
              :disabled="!editText.trim() || chatStore.isLoading"
              class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-white text-wut-700 hover:bg-wut-50 disabled:opacity-50 transition-colors"
              @click="saveEdit"
            >
              保存并重发
            </button>
          </div>
        </div>
        <div v-else-if="isUser || isError" class="whitespace-pre-wrap leading-relaxed">{{ messageText }}</div>

        <!-- 政策问答步骤卡片（后端解析的结构化 JSON） -->
        <ProcessCard v-if="isModel && !isError && message.processCard" :card="message.processCard" />

        <!-- V2.0 自动路由徽标：后端意图识别结果（替代原手动 RAG 开关） -->
        <div v-if="showIntentBadge" class="mt-2 inline-flex items-center gap-1 rounded-full bg-wut-50/80 dark:bg-wut-900/20 border border-wut-100 dark:border-wut-800/40 px-2 py-0.5">
          <span class="w-1.5 h-1.5 rounded-full bg-wut-500"></span>
          <span class="text-[10px] font-medium text-wut-600 dark:text-wut-300">{{ intentLabel }}</span>
        </div>

        <!-- 运行时引用校验：溯源覆盖率标注（低溯源提示用户谨慎采信） -->
        <div
          v-if="showGroundingBadge"
          :title="`共 ${grounding.totalSentences} 句，其中 ${grounding.unsupportedCount} 句未在引用资料中找到依据`"
          class="mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5"
          :class="groundingBadgeClass"
        >
          <span class="text-[10px] font-medium">{{ groundingLabel }}</span>
        </div>

        <!-- token 用量：仅后端返回 usage 时展示（流式收尾 / Agent 非流式路径） -->
        <div
          v-if="isModel && !isError && !isStreaming && usageLabel"
          class="mt-1 text-[10px] text-slate-400 dark:text-gray-500"
          title="本次回答的 token 消耗（模型服务返回口径）"
        >
          {{ usageLabel }}
        </div>

        <!-- 追问建议：从引用文档/章节标题零成本生成，点击直接提问 -->
        <div v-if="isModel && !isError && !isStreaming && followups.length" class="mt-2 flex flex-wrap gap-1.5">
          <button
            v-for="item in followups"
            :key="item.text"
            type="button"
            :disabled="chatStore.isLoading"
            class="inline-flex items-center gap-1 rounded-full border border-wut-100 bg-wut-50/60 px-2.5 py-1 text-[11px] font-medium text-wut-600 transition hover:border-wut-300 hover:bg-wut-100 disabled:opacity-50 dark:border-wut-800/50 dark:bg-wut-900/20 dark:text-wut-300 dark:hover:border-wut-700 dark:hover:bg-wut-900/40"
            :title="item.from === 'heading' ? '来自引用文档的章节' : '来自引用文档'"
            @click="sendFollowup(item.text)"
          >
            <span class="text-wut-400 dark:text-wut-500">↳</span>
            {{ item.text }}
          </button>
        </div>

        <!-- L2 工具调度卡片：展示 tool_call / tool_result（Agent 路径透明化） -->
        <AgentToolPanel
          v-if="isModel && !isError && toolCalls.length"
          :tool-calls="toolCalls"
          :tool-results="toolResults"
          :agent-trace="agentTrace"
        />

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

        <!-- Footer with time and actions（反馈/语音/复制/收藏/编辑/分叉） -->
        <MessageActions
          :message="message"
          :question-message="questionMessage"
          :message-text="messageText"
          :is-user="isUser"
          :is-model="isModel"
          :is-error="isError"
          :is-streaming="isStreaming"
          :time-classes="timeClasses"
          :editing="editing"
          @copy="(text) => emit('copy', text)"
          @start-edit="startEdit"
        />
      </div>
    </div>

    <!-- 行内引用弹窗 -->
    <CitationPopup :popup="citationPopup" @close="citationPopup = null" />
  </div>
</template>

<style scoped>
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
