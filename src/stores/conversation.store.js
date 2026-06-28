import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  fetchConversations,
  createConversation as apiCreateConversation,
  fetchConversation,
  renameConversation as apiRenameConversation,
  deleteConversation as apiDeleteConversation,
} from '../api/conversations.js';
import { useAuthStore } from './auth.store.js';
import {
  normalizeMessages,
  createWelcomeMessage,
  createLocalConversation,
  getMessageText,
} from '../utils/chatHelpers.js';
import {
  loadCache,
  saveCache,
  saveIncremental,
  restoreFromLegacyBackups,
  cleanupLegacyKeys,
} from '../utils/conversationCache.js';

const CURRENT_CONVERSATION_KEY = 'chat_current_conversation_id';

// ==================== 统一缓存管理 ====================
// 使用 conversationCache.js 统一管理 localStorage 持久化
// 增量保存：300ms 防抖，只写发生变更的会话

let saveTimer = null;

const scheduleSave = (conversations, currentId, dirtyConvId) => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveIncremental(conversations, currentId, dirtyConvId);
    saveTimer = null;
  }, 300);
};

const flushSave = (conversations, currentId) => {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  saveCache(conversations, currentId);
};

export const useConversationStore = defineStore('conversation', () => {
  let authStore = null;

  const getAuthStore = () => {
    if (!authStore) authStore = useAuthStore();
    return authStore;
  };

  const conversations = ref([]);
  const currentConversationId = ref(localStorage.getItem(CURRENT_CONVERSATION_KEY) || '');
  const isLoaded = ref(false);

  const currentConversation = computed(() =>
    conversations.value.find((c) => c.id === currentConversationId.value)
  );

  const sortedConversations = computed(() =>
    [...conversations.value].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  );

  const isLocalSession = (id) => !id || id === 'local' || id.startsWith('local_');

  const isBackendAvailable = () => {
    const auth = getAuthStore();
    return auth.isAuthenticated;
  };

  const loadConversations = async () => {
    if (!isBackendAvailable()) {
      if (conversations.value.length === 0) {
        ensureLocalFallback(conversations, currentConversationId);
      }
      isLoaded.value = true;
      // 离线状态下也尝试迁移旧数据
      if (conversations.value.length > 0) {
        const restored = restoreFromLegacyBackups(conversations.value);
        if (restored !== conversations.value) {
          conversations.value = restored;
        }
      }
      cleanupLegacyKeys();
      return;
    }

    try {
      const data = await fetchConversations();
      if (data.length === 0) {
        // 后端返回空（可能 Redis 未启动），从统一缓存恢复
        const cached = loadCache();
        if (cached?.conversations?.length > 0) {
          conversations.value = cached.conversations;
          currentConversationId.value = cached.currentId || cached.conversations[0].id;
        } else {
          const localConv = createLocalConversation('新会话');
          conversations.value = [localConv];
          currentConversationId.value = localConv.id;
        }
      } else {
        conversations.value = data.map((conv) => ({ ...conv, messages: [] }));
        if (currentConversationId.value && !conversations.value.find((c) => c.id === currentConversationId.value)) {
          currentConversationId.value = conversations.value[0]?.id || '';
        }
        if (!currentConversationId.value && conversations.value.length > 0) {
          currentConversationId.value = conversations.value[0].id;
        }
      }
      isLoaded.value = true;
      // 首次加载成功后清理旧版备份
      cleanupLegacyKeys();
    } catch (error) {
      console.error('Failed to load conversations:', error);
      if (conversations.value.length === 0) {
        ensureLocalFallback(conversations, currentConversationId);
      }
      isLoaded.value = true;
    }
  };

  // 从统一缓存恢复消息（兼容旧版备份迁移）
  const tryRestoreFromBackup = () => {
    const conv = currentConversation.value;
    if (!conv) return;
    const hasRealMessages = (conv.messages || []).some((m) => m.id !== 'welcome' && getMessageText(m));
    if (hasRealMessages) return;

    // 检查是否已迁移到新缓存
    const cached = loadCache();
    if (cached?.conversations) {
      const cachedConv = cached.conversations.find(c => c.id === conv.id);
      if (cachedConv?.messages?.length > 1) {
        conversations.value = conversations.value.map(c =>
          c.id === conv.id ? { ...c, messages: cachedConv.messages } : c
        );
        return;
      }
    }

    // 从旧版备份恢复（一次性迁移）
    const restored = restoreFromLegacyBackups(conversations.value);
    if (restored.length > 0 && restored !== conversations.value) {
      conversations.value = restored;
    }
  };

  const createConversation = async (title) => {
    if (!isBackendAvailable()) {
      const localConv = createLocalConversation(title, conversations.value.length);
      conversations.value.unshift(localConv);
      currentConversationId.value = localConv.id;
      localStorage.setItem(CURRENT_CONVERSATION_KEY, localConv.id);
      return localConv.id;
    }

    try {
      const conv = await apiCreateConversation(title || `新会话 ${conversations.value.length + 1}`);
      conversations.value.unshift({ ...conv, messages: [createWelcomeMessage()] });
      currentConversationId.value = conv.id;
      localStorage.setItem(CURRENT_CONVERSATION_KEY, conv.id);
      flushSave(conversations.value, conv.id);
      return conv.id;
    } catch (error) {
      console.error('创建会话失败:', error);
      const localConv = createLocalConversation(title, conversations.value.length);
      conversations.value.unshift(localConv);
      currentConversationId.value = localConv.id;
      localStorage.setItem(CURRENT_CONVERSATION_KEY, localConv.id);
      return localConv.id;
    }
  };

  const switchConversation = async (id) => {
    if (!conversations.value.some((c) => c.id === id)) return;
    currentConversationId.value = id;
    localStorage.setItem(CURRENT_CONVERSATION_KEY, id);

    const conv = conversations.value.find((c) => c.id === id);
    if (conv && (!conv.messages || conv.messages.length === 0)) {
      await loadConversationMessages(id);
    }
    flushSave(conversations.value, id);
  };

  const loadConversationMessages = async (conversationId) => {
    if (isLocalSession(conversationId) || !isBackendAvailable()) return;

    try {
      const conv = await fetchConversation(conversationId);
      // 竞态条件防护：加载完成后验证当前会话是否已切换
      if (currentConversationId.value !== conversationId) return;
      const index = conversations.value.findIndex((c) => c.id === conversationId);
      if (index !== -1 && conv) {
        const normalized = normalizeMessages(conv.messages);
        conversations.value[index].messages = normalized.length > 0 ? normalized : [createWelcomeMessage()];
        conversations.value[index].title = conv.title;
      }
    } catch (error) {
      console.error('加载会话消息失败:', error);
    }
  };

  const renameConversation = async (id, title) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    const conv = conversations.value.find((c) => c.id === id);
    if (conv) conv.title = trimmedTitle;

    if (!isLocalSession(id) && isBackendAvailable()) {
      try {
        await apiRenameConversation(id, trimmedTitle);
      } catch (error) {
        console.error('重命名会话失败:', error);
      }
    }
    scheduleSave(conversations.value, currentConversationId.value, id);
  };

  const deleteConversation = async (id) => {
    const targetIndex = conversations.value.findIndex((c) => c.id === id);
    if (targetIndex === -1) return;

    conversations.value.splice(targetIndex, 1);

    if (!isLocalSession(id) && isBackendAvailable()) {
      try {
        await apiDeleteConversation(id);
      } catch (error) {
        console.error('删除会话失败:', error);
      }
    }

    if (currentConversationId.value === id) {
      if (conversations.value.length === 0) {
        await createConversation('默认会话');
      } else {
        currentConversationId.value = conversations.value[Math.max(0, targetIndex - 1)]?.id || conversations.value[0].id;
      }
    }

    // 同步删除 localStorage 中的缓存，防止刷新后恢复已删除会话
    flushSave(conversations.value, currentConversationId.value);
  };

  // 去除 markdown 标记符号，用于预览文本显示
  const stripMarkdown = (text) => {
    if (!text) return '';
    return text
      // 加粗/斜体/删除线：**text**、*text*、__text__、~~text~~
      .replace(/(\*{1,3}|_{1,3}|~~)(.+?)\1/g, '$2')
      // 行内代码：`text`
      .replace(/`([^`]+)`/g, '$1')
      // 标题标记：### text → text
      .replace(/^#{1,6}\s+/gm, '')
      // 列表标记：- text、* text、+ text、1. text
      .replace(/^[\s]*[-*+]\s+/gm, '')
      .replace(/^[\s]*\d+\.\s+/gm, '')
      // 引用标记：> text
      .replace(/^>\s+/gm, '')
      // 链接： [text](url) → text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // 图片： ![alt](url) → alt
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      // 清理多余空格和换行
      .replace(/\s+/g, ' ')
      .trim();
  };

  const getLastMessagePreview = (conversation) => {
    const lastMessage = [...(conversation.messages || [])]
      .reverse()
      .find((m) => m.id !== 'welcome' && getMessageText(m));
    if (!lastMessage) return '点击开始新对话';
    const text = stripMarkdown(getMessageText(lastMessage));
    return text.length > 22 ? `${text.slice(0, 22)}...` : text;
  };

  // 统一消息文本读取（优先 content，降级 text）— 已从 chatHelpers 导入

  // ========== 统一 localStorage 持久化 ==========

  const flushSaveCache = () => {
    flushSave(conversations.value, currentConversationId.value);
  };

  const scheduleSaveCache = (immediate = false) => {
    const conv = currentConversation.value;
    if (immediate) {
      flushSave(conversations.value, currentConversationId.value);
    } else {
      scheduleSave(conversations.value, currentConversationId.value, conv?.id);
    }
  };

  // 页面刷新/关闭前将未保存的数据刷入 localStorage
  const setupBeforeUnload = () => {
    window.addEventListener('beforeunload', () => {
      flushSave(conversations.value, currentConversationId.value);
      // 确保当前会话 ID 也持久化
      if (currentConversationId.value) {
        localStorage.setItem(CURRENT_CONVERSATION_KEY, currentConversationId.value);
      }
    });
  };

  // 初始化时注册 beforeunload
  setupBeforeUnload();

  return {
    conversations,
    currentConversationId,
    currentConversation,
    sortedConversations,
    isLoaded,
    loadConversations,
    loadConversationMessages,
    createConversation,
    switchConversation,
    renameConversation,
    deleteConversation,
    getLastMessagePreview,
    isLocalSession,
    isBackendAvailable,
    scheduleSaveCache,
  };
});
