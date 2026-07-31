<script setup>
import { ref, watch, nextTick, computed, onMounted } from 'vue';
import { useChatStore } from '../stores/chat.store.js';
import { useToastStore } from '../stores/toast.store.js';
import { useLanguageStore } from '../stores/language.store.js';
import { Bot, Eraser } from 'lucide-vue-next';
import MessageList from '../components/chat/MessageList.vue';
import ChatBox from '../components/chat/ChatBox.vue';
import ConfirmDialog from '../components/common/ConfirmDialog.vue';
import MobileMenuButton from '../components/layout/MobileMenuButton.vue';

const chatStore = useChatStore();
const toast = useToastStore();
const languageStore = useLanguageStore();
const text = computed(() => languageStore.tm('aiChat'));
const messageListRef = ref(null);

const currentTitle = computed(() => chatStore.currentConversation?.title || text.value.assistantTitle);
const effectiveMessageCount = computed(() => chatStore.messages.filter((msg) => msg.id !== 'welcome' && msg.text?.trim()).length);
const canClear = computed(() => effectiveMessageCount.value > 0 && !chatStore.isLoading);

const showClearConfirm = ref(false);

const confirmClear = () => {
  showClearConfirm.value = false;
  Promise.resolve(chatStore.clearMessages()).catch((e) => {
    console.error('[AIChat] 清空会话异常:', e);
  });
};

// 当前对话模式（已移除 Agent，始终为 chat）
const activeMode = ref('chat');
const onModeChange = (mode) => {
  activeMode.value = mode;
};

const handleSend = async (message, fileData = null) => {
  await chatStore.sendMessage(message, null, fileData);
  scrollToBottom();
};

const handleError = (message) => {
  toast.error(message);
};

const handleCopy = () => {
  toast.success(text.value.copied);
};

// 导出对话
const handleCommand = (command) => {
  if (command === 'export') {
    exportConversation();
  }
};

const exportConversation = () => {
  const conv = chatStore.currentConversation;
  if (!conv || !conv.messages || conv.messages.length === 0) {
    toast.warning('当前会话没有内容可导出');
    return;
  }

  // 构建 Markdown 内容
  const lines = [];
  lines.push(`# ${conv.title || '对话记录'}`);
  lines.push('');
  lines.push(`> 导出时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push('');

  conv.messages.forEach((msg) => {
    if (msg.id === 'welcome') return;
    const role = msg.role === 'user' ? '👤 用户' : '🤖 AI';
    lines.push(`### ${role}`);
    lines.push('');
    lines.push(msg.text);
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  const content = lines.join('\n');
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${conv.title || '对话记录'}_${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  toast.success('对话已导出为 Markdown 文件');
};

const initializeChat = async () => {
  // forceRefresh=true：切换页面回来时从 localStorage 重新加载（本地模式）
  await chatStore.loadConversations(true);

  // 没有消息备份，走正常加载流程
  if (chatStore.currentConversationId) {
    await chatStore.loadConversationMessages(chatStore.currentConversationId);
  }
  await scrollToBottom();
};

const scrollToBottom = async () => {
  await nextTick();
  messageListRef.value?.scrollToBottom();
};

watch(() => chatStore.messages.length, scrollToBottom);
watch(() => chatStore.currentConversationId, scrollToBottom);
onMounted(() => {
  // Pinia store 跨路由切换保持存活。
  // 只有首次加载（页面刷新）才需要从 localStorage/后端拉数据，
  // 切换标签页回来时 store 里的消息仍然存在，无需重新加载。
  if (!chatStore.isLoaded) {
    initializeChat();
  }
});
</script>

<template>
  <div class="flex flex-col h-full bg-white dark:bg-gray-900 overflow-hidden relative">
    <div class="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none" style="background-image: radial-gradient(circle at 2px 2px, gray 1px, transparent 0); background-size: 24px 24px;"></div>

    <!-- 顶部标题栏 -->
    <div class="bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm p-4 border-b border-slate-200 dark:border-gray-700 flex items-center justify-between z-10 gap-3 shrink-0">
      <div class="flex items-center min-w-0">
        <MobileMenuButton />
        <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-500 to-indigo-400 flex items-center justify-center mr-3 shadow-lg shadow-blue-500/20 text-white">
          <Bot :size="20" />
        </div>
        <div class="min-w-0">
          <h3 class="font-bold text-slate-800 dark:text-white text-sm truncate">{{ currentTitle }}</h3>
          <div class="flex items-center mt-0.5">
            <span class="w-1.5 h-1.5 rounded-full bg-blue-500 mr-1.5 animate-pulse"></span>
            <span class="text-[10px] font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wide">{{ text.model }}</span>
            <span class="mx-1 text-slate-300 dark:text-gray-600">·</span>
            <span class="text-[10px] text-slate-500 dark:text-gray-400">{{ effectiveMessageCount }} 条消息</span>
          </div>
        </div>
      </div>
      <button
        @click="showClearConfirm = true"
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

    <!-- 消息列表 -->
    <MessageList ref="messageListRef" :messages="chatStore.messages" :is-loading="chatStore.isLoading" :current-streaming-id="chatStore.currentStreamingId" @copy="handleCopy" />

    <!-- 输入框 -->
    <ChatBox
      :is-loading="chatStore.isLoading"
      :placeholder="text.inputPlaceholder"
      :is-connected="chatStore.isConnected"
      :is-reconnecting="chatStore.isReconnecting"
      :reconnect-attempt="chatStore.reconnectAttempt"
      :active-mode="activeMode"
      @send="handleSend"
      @error="handleError"
      @command="handleCommand"
      @mode-change="onModeChange"
    />
  </div>

  <ConfirmDialog
    :show="showClearConfirm"
    title="清空会话"
    message="确定要清空当前会话吗？此操作不可撤销。"
    confirm-text="确认清空"
    cancel-text="取消"
    :danger="true"
    @confirm="confirmClear"
    @cancel="showClearConfirm = false"
  />
</template>
