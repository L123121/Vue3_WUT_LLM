import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  fetchConversations,
  createConversation as apiCreateConversation,
  fetchConversation,
  renameConversation as apiRenameConversation,
  deleteConversation as apiDeleteConversation,
  saveConversationMessages as apiSaveMessages,
} from '../api/conversations.js';
import { useAuthStore } from './auth.store.js';
import { reportError } from '../utils/errorHandler.js';
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
  cleanupLegacyKeys,
} from '../utils/conversationCache.js';

const CURRENT_CONVERSATION_KEY = 'chat_current_conversation_id';

// ==================== 消息索引（加速查找） ====================
// messagesMap: messageId -> { conversationId, message }
// 纯索引结构，非响应式（避免深层依赖追踪开销），O(1) 按 ID 查找消息
const messagesMap = new Map();

function _registerMessage(convId, msg) {
  if (msg?.id) messagesMap.set(msg.id, { conversationId: convId, message: msg });
}

function _registerConversationMessages(convId, messages) {
  for (const msg of messages) _registerMessage(convId, msg);
}

function _unregisterMessage(msgId) {
  messagesMap.delete(msgId);
}

function _unregisterConversationMessages(convId) {
  for (const [id, entry] of messagesMap) {
    if (entry.conversationId === convId) messagesMap.delete(id);
  }
}

function _rebuildMessagesMap(conversations) {
  messagesMap.clear();
  for (const conv of conversations) {
    for (const msg of (conv.messages || [])) {
      _registerMessage(conv.id, msg);
    }
  }
}

// ==================== 统一缓存管理 ====================
// 使用 conversationCache.js 统一管理 localStorage 持久化
// 增量保存：300ms 防抖，只写发生变更的会话

let saveTimer = null;
let backendSyncTimer = null;
let loadingPromise = null; // loadConversations 并发保护：缓存 in-flight promise

// ==================== 后端消息同步 ====================
// 在每次 localStorage 保存时，连带将消息推送到后端 API，
// 实现多端同步 + 安全存储（敏感内容不在 localStorage 停留）。
//
// 设计原则：
// - 非阻塞：后端同步失败不影响本地使用（localStorage 兜底）
// - 防抖：500ms 合并连续写入，避免流式每帧都发请求
// - 静默失败：catch 不弹 toast，仅 console.warn 留痕
// - 仅同步会话消息，不覆盖 title（title 由 renameConversation 单独管理）
const _triggerBackendSync = async () => {
  // 从模块变量读取最新 store 状态（兼容定时器/外部调用场景）
  const store = latestStoreRef.value;
  if (!store) return;
  const convId = store.currentConversationId;
  // 本地会话不推后端
  if (!convId || convId.startsWith('local_') || convId === 'local') return;

  // 检查认证状态（直接调用 light 版本避免创建 auth store 实例竞争）
  try {
    const authStore = useAuthStore();
    if (!authStore.isAuthenticated) return;
  } catch {
    return; // 未初始化
  }

  const conv = store.conversations.find((c) => c.id === convId);
  if (!conv || !conv.messages || conv.messages.length === 0) return;

  try {
    await apiSaveMessages(convId, conv.messages);
  } catch (e) {
    reportError('BackendSync', e, { convId });
  }
};

const _scheduleBackendSync = (delay = 500) => {
  if (backendSyncTimer) clearTimeout(backendSyncTimer);
  backendSyncTimer = setTimeout(() => {
    _triggerBackendSync();
    backendSyncTimer = null;
  }, delay);
};

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

const ensureLocalFallback = (conversationsRef, currentConversationIdRef) => {
  const localConv = createLocalConversation('新会话');
  conversationsRef.value = [localConv];
  currentConversationIdRef.value = localConv.id;
  localStorage.setItem(CURRENT_CONVERSATION_KEY, localConv.id);
  flushSave(conversationsRef.value, currentConversationIdRef.value);
};

// 模块级单例：beforeunload 监听 + 自动保存定时器
// store 可能在 HMR/测试中被多次实例化，用模块级变量保证只注册一次，
// 并提供 dispose 以便测试 / 应用卸载时清理，避免内存与监听器泄漏。
let beforeUnloadRegistered = false;
let autoSaveTimer = null;
const latestStoreRef = { value: null }; // 间接持有最近一次 store 实例的状态 getter

const beforeUnloadHandler = () => {
  const store = latestStoreRef.value;
  if (!store) return;
  flushSave(store.conversations, store.currentConversationId);
  if (store.currentConversationId) {
    localStorage.setItem(CURRENT_CONVERSATION_KEY, store.currentConversationId);
  }
};

// 供测试 / 应用卸载调用：清理模块级定时器与监听
export const disposeConversationStore = () => {
  if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null; }
  if (backendSyncTimer) { clearTimeout(backendSyncTimer); backendSyncTimer = null; }
  if (beforeUnloadRegistered && typeof window !== 'undefined') {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    beforeUnloadRegistered = false;
  }
  latestStoreRef.value = null;
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
    // 并发保护：如果已有正在加载的请求，复用同一个 promise
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
    if (!isBackendAvailable()) {
      if (conversations.value.length === 0) {
        ensureLocalFallback(conversations, currentConversationId);
      }
      isLoaded.value = true;
      // 本地会话也需要建立消息索引
      _rebuildMessagesMap(conversations.value);
      return;
    }

    try {
      // 优先从 localStorage 缓存恢复本地会话（含消息）
      const cached = loadCache();
      if (cached) console.debug(`[Cache] 找到缓存: ${cached.conversations?.length || 0} 个会话, currentId=${cached.currentId?.substring(0, 20)}`);
      else console.warn('[Cache] 缓存为空或版本不匹配');
      let hasLocalConversations = false;
      if (cached?.conversations?.length > 0) {
        conversations.value = cached.conversations;
        currentConversationId.value = cached.currentId || cached.conversations[0].id;
        hasLocalConversations = true;
      }

      // 尝试从后端加载服务端会话（补充合并）
      const data = await fetchConversations();
      if (data.length > 0) {
        // 后端有数据：合并到当前会话列表（去重，本地会话优先保留消息）
        const serverIds = new Set(data.map(c => c.id));
        const serverConvs = data.map(conv => ({ ...conv, messages: [] }));
        // 保留本地有但后端没有的会话（本地创建的会话）
        const localOnly = hasLocalConversations
          ? conversations.value.filter(c => !serverIds.has(c.id))
          : [];
        conversations.value = [...serverConvs, ...localOnly];
        if (!currentConversationId.value && conversations.value.length > 0) {
          currentConversationId.value = conversations.value[0].id;
        }
      } else if (!hasLocalConversations) {
        // 后端和缓存都空 → 创建默认会话
        const localConv = createLocalConversation('新会话');
        conversations.value = [localConv];
        currentConversationId.value = localConv.id;
      }
      isLoaded.value = true;
      // 首次加载成功后清理旧版备份
      cleanupLegacyKeys();

      // 重建消息索引，加速后续按 ID 查找
      _rebuildMessagesMap(conversations.value);

      // 如果当前会话是后端会话且消息为空，自动从后端拉取
      const currentId = currentConversationId.value;
      if (currentId && !isLocalSession(currentId) && data?.length > 0) {
        const currentConv = conversations.value.find((c) => c.id === currentId);
        const hasRealMessages = (currentConv?.messages || []).some((m) => m.id !== 'welcome' && getMessageText(m));
        if (!hasRealMessages) {
          loadConversationMessages(currentId);
        }
      }
    } catch (error) {
      reportError('loadConversations', error);
      if (conversations.value.length === 0) {
        ensureLocalFallback(conversations, currentConversationId);
      }
      isLoaded.value = true;
    }
  })();
  loadingPromise.finally(() => { loadingPromise = null; });
  return loadingPromise;
  };

  // 从统一缓存恢复消息（兼容旧版备份迁移）
  const createConversation = async (title) => {
    if (!isBackendAvailable()) {
      const localConv = createLocalConversation(title, conversations.value.length);
      conversations.value.unshift(localConv);
      currentConversationId.value = localConv.id;
      localStorage.setItem(CURRENT_CONVERSATION_KEY, localConv.id);
      _registerMessage(localConv.id, localConv.messages?.[0]);
      return localConv.id;
    }

    try {
      const conv = await apiCreateConversation(title || `新会话 ${conversations.value.length + 1}`);
      const welcomeMsg = createWelcomeMessage();
      conversations.value.unshift({ ...conv, messages: [welcomeMsg] });
      currentConversationId.value = conv.id;
      localStorage.setItem(CURRENT_CONVERSATION_KEY, conv.id);
      _registerMessage(conv.id, welcomeMsg);
      flushSave(conversations.value, conv.id);
      return conv.id;
    } catch (error) {
      console.error('创建会话失败:', error);
      const localConv = createLocalConversation(title, conversations.value.length);
      conversations.value.unshift(localConv);
      currentConversationId.value = localConv.id;
      localStorage.setItem(CURRENT_CONVERSATION_KEY, localConv.id);
      _registerMessage(localConv.id, localConv.messages?.[0]);
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
        // 消息整体替换，重建该会话的索引
        _unregisterConversationMessages(conversationId);
        _registerConversationMessages(conversationId, conversations.value[index].messages);
      }
    } catch (error) {
      reportError('loadConversationMessages', error, { conversationId });
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
    // 删除会话时同步清理该会话的消息索引
    _unregisterConversationMessages(id);

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

  const scheduleSaveCache = (immediate = false) => {
    const conv = currentConversation.value;
    if (immediate) {
      flushSave(conversations.value, currentConversationId.value);
      _triggerBackendSync(); // 立即同步到后端（fire-and-forget）
    } else {
      scheduleSave(conversations.value, currentConversationId.value, conv?.id);
      _scheduleBackendSync(500); // 防抖同步到后端
    }
  };

  // 页面刷新/关闭前将未保存的数据刷入 localStorage
  // 模块级单次注册：store 可能在 HMR/测试中被多次实例化，
  // 用标志位避免重复注册 beforeunload 监听和定时器造成泄漏
  const setupBeforeUnload = () => {
    if (beforeUnloadRegistered) return;
    beforeUnloadRegistered = true;
    window.addEventListener('beforeunload', beforeUnloadHandler);
  };
  setupBeforeUnload();

  // 定时自动保存（每 30 秒，确保聊天气泡的内容在刷新前已完成持久化）
  if (!autoSaveTimer) {
    autoSaveTimer = setInterval(() => {
      // 定时器在 store 外部，无法直接访问当前实例的 conversations；
      // 通过 latestStoreRef 间接引用最近一次实例化的 store
      const store = latestStoreRef.value;
      if (store && store.conversations.length > 0) {
        flushSave(store.conversations, store.currentConversationId);
      }
    }, 30000);
    if (autoSaveTimer && autoSaveTimer.unref) autoSaveTimer.unref();
  }
  latestStoreRef.value = {
    get conversations() { return conversations.value; },
    get currentConversationId() { return currentConversationId.value; },
  };

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
    // 消息索引 API（O(1) 按 ID 查找，供外部修改消息后同步）
    getMessage: (id) => messagesMap.get(id) || null,
    registerMessage: _registerMessage,
    unregisterMessage: _unregisterMessage,
    rebuildMessagesMap: () => _rebuildMessagesMap(conversations.value),
  };
});
