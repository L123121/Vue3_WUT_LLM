<script setup>
import { ref, watch, nextTick, computed, onMounted } from 'vue';
import { useChatStore } from '../stores/chat.store.js';
import { useToastStore } from '../stores/toast.store.js';
import { useLanguageStore } from '../stores/language.store.js';
import { useFavoritesStore } from '../stores/favorites.store.js';
import { Bot, Eraser, Download, ClipboardCopy, FileText, FileCode2, Share2, BookOpen, GraduationCap, Landmark, Library } from 'lucide-vue-next';
import MessageList from '../components/chat/MessageList.vue';
import ChatBox from '../components/chat/ChatBox.vue';
import ConfirmDialog from '../components/common/ConfirmDialog.vue';
import MobileMenuButton from '../components/layout/MobileMenuButton.vue';
import { createShareSnapshot } from '../api/share.js';

const chatStore = useChatStore();
const toast = useToastStore();
const languageStore = useLanguageStore();
const favoritesStore = useFavoritesStore();
const text = computed(() => languageStore.tm('aiChat'));
const messageListRef = ref(null);
const chatBoxRef = ref(null);

// 拒答引导「换个问法」：聚焦输入框
const focusChatInput = () => {
  chatBoxRef.value?.focus();
};

// 空状态示例问题（武理校园场景，点击直接提问）
const exampleQuestions = [
  { icon: Landmark, text: '校园卡丢了怎么补办？' },
  { icon: Library, text: '图书馆期末周几点闭馆？' },
  { icon: GraduationCap, text: '推免保研需要准备哪些材料？' },
  { icon: BookOpen, text: '大二专业课复习怎么规划？' },
];

// 收藏夹点击后滚动定位到指定消息
const scrollToFavoritedMessage = async (messageId) => {
  if (!messageId) return;
  await nextTick();
  const el = document.getElementById(`msg-${messageId}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    // 消息不在当前视图（例如刚切换会话），等待加载后重试
    setTimeout(() => {
      const retryEl = document.getElementById(`msg-${messageId}`);
      if (retryEl) retryEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 400);
  }
  favoritesStore.consumeScrollRequest();
};

watch(() => favoritesStore.pendingScrollMessageId, (id) => {
  scrollToFavoritedMessage(id);
});

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

// V2.0：对话模式由后端意图识别自动路由，前端不再手动切换 RAG

const handleSend = async (message, fileData = null) => {
  try {
    await chatStore.sendMessage(message, null, fileData);
  } catch (e) {
    console.error('[AIChat] 发送失败:', e);
    toast.error(e?.message || '发送失败，请检查网络后重试');
  }
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

// 导出下拉菜单状态
const showExportMenu = ref(false);
const closeExportMenu = () => { showExportMenu.value = false; };

// 获取当前会话的有效消息（跳过欢迎语）
const getExportMessages = (conv) => {
  if (!conv || !conv.messages || conv.messages.length === 0) return null;
  const messages = conv.messages.filter((msg) => msg.id !== 'welcome' && msg.text?.trim());
  return messages.length > 0 ? messages : null;
};

// 构建纯文本内容
const buildPlainText = (conv, messages) => {
  const lines = [];
  lines.push(`# ${conv.title || '对话记录'}`);
  lines.push(`导出时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push('');
  messages.forEach((msg) => {
    const role = msg.role === 'user' ? '👤 用户' : '🤖 AI';
    lines.push(`【${role}】`);
    lines.push(msg.text);
    lines.push('');
  });
  return lines.join('\n');
};

// 构建 Markdown 内容
const buildMarkdown = (conv, messages) => {
  const lines = [];
  lines.push(`# ${conv.title || '对话记录'}`);
  lines.push('');
  lines.push(`> 导出时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push('');
  messages.forEach((msg) => {
    const role = msg.role === 'user' ? '👤 用户' : '🤖 AI';
    lines.push(`### ${role}`);
    lines.push('');
    lines.push(msg.text);
    lines.push('');
    lines.push('---');
    lines.push('');
  });
  return lines.join('\n');
};

// 构建 HTML 内容（内联样式，离线可打开）
const buildHtml = (conv, messages) => {
  const escapeHtml = (str) => String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/\n/g, '<br/>');
  const items = messages.map((msg) => {
    const isUser = msg.role === 'user';
    const text = escapeHtml(msg.text);
    return `
      <div class="message ${isUser ? 'user' : 'ai'}">
        <div class="avatar">${isUser ? '用户' : 'AI'}</div>
        <div class="bubble">${text}</div>
      </div>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(conv.title || '对话记录')} — 武理小精灵</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f1f5f9; padding: 24px 16px; }
  .header { max-width: 720px; margin: 0 auto 20px; text-align: center; }
  .header h1 { font-size: 18px; color: #1e293b; }
  .header p { font-size: 12px; color: #94a3b8; margin-top: 6px; }
  .chat { max-width: 720px; margin: 0 auto; }
  .message { display: flex; gap: 10px; margin-bottom: 14px; align-items: flex-start; }
  .message.user { flex-direction: row-reverse; }
  .avatar { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #fff; flex-shrink: 0; }
  .user .avatar { background: #bfdbfe; color: #1e40af; }
  .ai .avatar { background: linear-gradient(135deg, #3b82f6, #818cf8); }
  .bubble { max-width: 75%; padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.7; word-break: break-word; }
  .user .bubble { background: #2563eb; color: #fff; border-top-right-radius: 4px; }
  .ai .bubble { background: #fff; color: #334155; border: 1px solid #e2e8f0; border-top-left-radius: 4px; }
  .footer { max-width: 720px; margin: 28px auto 0; text-align: center; font-size: 11px; color: #cbd5e1; }
</style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(conv.title || '对话记录')}</h1>
    <p>由武理小精灵 AI 助手导出 · ${new Date().toLocaleString('zh-CN')}</p>
  </div>
  <div class="chat">${items}</div>
  <div class="footer">武理小精灵 WUT Assistant</div>
</body>
</html>`;
};

// 下载 Blob 文件
const downloadBlob = (content, type, filename) => {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const dateSuffix = () => new Date().toISOString().slice(0, 10);

// 复制为纯文本
const copyConversationAsText = async () => {
  const conv = chatStore.currentConversation;
  const messages = getExportMessages(conv);
  if (!messages) {
    toast.warning('当前会话没有内容可复制');
    return;
  }
  try {
    await navigator.clipboard.writeText(buildPlainText(conv, messages));
    toast.success('对话已复制为纯文本');
  } catch (error) {
    console.error('[AIChat] 复制失败:', error);
    toast.error('复制失败，请手动选择复制');
  } finally {
    closeExportMenu();
  }
};

// 导出为 Markdown
const exportConversation = () => {
  const conv = chatStore.currentConversation;
  const messages = getExportMessages(conv);
  if (!messages) {
    toast.warning('当前会话没有内容可导出');
    return;
  }
  downloadBlob(
    buildMarkdown(conv, messages),
    'text/markdown',
    `${conv.title || '对话记录'}_${dateSuffix()}.md`
  );
  toast.success('对话已导出为 Markdown 文件');
  closeExportMenu();
};

// 导出为 HTML
const exportConversationAsHtml = () => {
  const conv = chatStore.currentConversation;
  const messages = getExportMessages(conv);
  if (!messages) {
    toast.warning('当前会话没有内容可导出');
    return;
  }
  downloadBlob(
    buildHtml(conv, messages),
    'text/html',
    `${conv.title || '对话记录'}_${dateSuffix()}.html`
  );
  toast.success('对话已导出为 HTML 文件');
  closeExportMenu();
};

// 生成分享链接
const shareConversation = async () => {
  const conv = chatStore.currentConversation;
  const messages = getExportMessages(conv);
  if (!messages) {
    toast.warning('当前会话没有内容可分享');
    return;
  }
  try {
    const { code, url } = await createShareSnapshot({
      title: conv.title || '对话记录',
      messages: messages.map((m) => ({
        role: m.role,
        text: m.text,
        timestamp: m.timestamp,
      })),
    });
    const fullUrl = `${window.location.origin}${url}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      toast.success('分享链接已复制到剪贴板');
    } catch {
      toast.success(`分享链接：${fullUrl}`);
    }
    console.debug('[AIChat] 分享链接已生成:', code);
  } catch (error) {
    console.error('[AIChat] 生成分享链接失败:', error);
    toast.error('生成分享链接失败，请稍后重试');
  } finally {
    closeExportMenu();
  }
};

const initializeChat = async () => {
  await chatStore.loadConversations();

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
        <div class="w-9 h-9 rounded-xl bg-wut-600 flex items-center justify-center mr-3 shadow-lg shadow-wut-500/20 text-white">
          <Bot :size="20" />
        </div>
        <div class="min-w-0">
          <h3 class="font-bold text-slate-800 dark:text-white text-sm truncate">{{ currentTitle }}</h3>
          <div class="flex items-center mt-0.5">
            <span class="w-1.5 h-1.5 rounded-full bg-wut-500 mr-1.5 animate-pulse"></span>
            <span class="text-[10px] font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wide">{{ text.model }}</span>
            <span class="mx-1 text-slate-300 dark:text-gray-600">·</span>
            <span class="text-[10px] text-slate-500 dark:text-gray-400">{{ effectiveMessageCount }} 条消息</span>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-1.5 relative">
        <!-- 导出/复制下拉菜单 -->
        <div class="relative">
          <button
            @click="showExportMenu = !showExportMenu"
            class="p-2 rounded-lg transition-colors duration-200 text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800"
            :title="'导出或复制对话'"
            aria-label="导出对话"
          >
            <Download :size="18" />
          </button>
          <Transition name="export-menu">
            <div
              v-if="showExportMenu"
              class="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-slate-200 dark:border-gray-700 overflow-hidden z-20 py-1"
            >
              <button
                @click="copyConversationAsText"
                class="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors"
              >
                <ClipboardCopy :size="14" class="text-slate-400 shrink-0" />
                <span>复制为纯文本</span>
              </button>
              <button
                @click="exportConversation"
                class="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors"
              >
                <FileText :size="14" class="text-slate-400 shrink-0" />
                <span>导出 Markdown</span>
              </button>
              <button
                @click="exportConversationAsHtml"
                class="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors"
              >
                <FileCode2 :size="14" class="text-slate-400 shrink-0" />
                <span>导出 HTML</span>
              </button>
              <div class="my-1 border-t border-slate-100 dark:border-gray-700"></div>
              <button
                @click="shareConversation"
                class="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-wut-600 dark:text-wut-400 hover:bg-wut-50 dark:hover:bg-wut-900/20 transition-colors"
              >
                <Share2 :size="14" class="shrink-0" />
                <span>生成分享链接</span>
              </button>
            </div>
          </Transition>
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
    </div>

    <!-- 空状态：仅欢迎消息时展示吉祥物 + 示例问题 -->
    <div
      v-if="effectiveMessageCount === 0 && !chatStore.isLoading"
      class="flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-6"
    >
      <div class="w-full max-w-2xl flex flex-col items-center text-center">
        <!-- 吉祥物徽章：武理蓝 + 金色印章 -->
        <div class="relative mb-6">
          <div class="w-20 h-20 rounded-full bg-wut-700 flex items-center justify-center shadow-lg shadow-wut-700/30">
            <Bot :size="36" class="text-white" />
          </div>
          <div class="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-wut-gold flex items-center justify-center text-wut-900 text-xs font-black shadow">武</div>
        </div>
        <p class="text-[11px] font-bold tracking-[0.3em] text-wut-600 dark:text-wut-400 uppercase mb-2">WUT CAMPUS AI</p>
        <h2 class="text-2xl font-black text-slate-800 dark:text-white mb-3">你好，我是武理小精灵</h2>
        <p class="text-sm text-slate-500 dark:text-gray-400 max-w-md leading-relaxed mb-8">
          基于武汉理工大学校园知识库的 AI 助手，覆盖选课、考试、图书馆、保研就业等校园指南，随时为你解答。
        </p>
        <!-- 示例问题卡：点击直接提问 -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-xl">
          <button
            v-for="q in exampleQuestions"
            :key="q.text"
            type="button"
            @click="handleSend(q.text)"
            class="group flex items-center gap-3 text-left p-4 rounded-2xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-wut-300 dark:hover:border-wut-600 hover:shadow-md transition-all duration-200"
          >
            <span class="w-9 h-9 rounded-xl bg-wut-50 dark:bg-wut-900/30 text-wut-600 dark:text-wut-400 flex items-center justify-center shrink-0 group-hover:bg-wut-100 dark:group-hover:bg-wut-900/50 transition-colors">
              <component :is="q.icon" :size="18" />
            </span>
            <span class="text-sm font-medium text-slate-700 dark:text-gray-300 group-hover:text-wut-700 dark:group-hover:text-wut-300 transition-colors">{{ q.text }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 消息列表 -->
    <MessageList
      v-else
      ref="messageListRef"
      :messages="chatStore.messages"
      :is-loading="chatStore.isLoading"
      :current-streaming-id="chatStore.currentStreamingId"
      @copy="handleCopy"
      @focus-input="focusChatInput"
    />

    <!-- 输入框 -->
    <ChatBox
      ref="chatBoxRef"
      :is-loading="chatStore.isLoading"
      :placeholder="text.inputPlaceholder"
      :is-connected="chatStore.isConnected"
      :is-reconnecting="chatStore.isReconnecting"
      :reconnect-attempt="chatStore.reconnectAttempt"
      @send="handleSend"
      @error="handleError"
      @command="handleCommand"
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

<style scoped>
/* 导出下拉菜单动画 */
.export-menu-enter-active {
  transition: opacity 0.15s ease-out, transform 0.15s ease-out;
}
.export-menu-leave-active {
  transition: opacity 0.1s ease-in;
}
.export-menu-enter-from,
.export-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
