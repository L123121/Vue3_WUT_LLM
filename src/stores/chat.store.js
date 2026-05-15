import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { sendMessageStream, connectionManager, generateTitle } from '../api/chat.js';
import {
  fetchConversations,
  createConversation as apiCreateConversation,
  fetchConversation,
  renameConversation as apiRenameConversation,
  deleteConversation as apiDeleteConversation,
  clearConversationMessages as apiClearMessages,
} from '../api/conversations.js';
import { useSkillStore } from './skill.store.js';
import { useAuthStore } from './auth.store.js';

const CURRENT_CONVERSATION_KEY = 'chat_current_conversation_id';
const LOCAL_CONVERSATIONS_KEY = 'chat_local_conversations_cache';

const createMessageId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const getMessageText = (msg) => {
  if (!msg) return '';
  return String(msg.text ?? msg.content ?? msg.message ?? '').trim();
};
const normalizeRole = (role) => {
  if (role === 'assistant') return 'model';
  return role || 'model';
};
const normalizeMessage = (msg = {}, index = 0) => ({
  ...msg,
  id: msg.id || createMessageId(),
  role: normalizeRole(msg.role),
  text: getMessageText(msg),
  timestamp: msg.timestamp || new Date(),
});
const normalizeMessages = (list) =>
  Array.isArray(list) ? list.map((msg, index) => normalizeMessage(msg, index)) : [];
const normalizeConversation = (conv = {}, index = 0) => ({
  ...conv,
  id: String(conv.id || `local_${Date.now()}_${index}`),
  title: String(conv.title || `新会话 ${index + 1}`),
  messages: (() => {
    const normalized = normalizeMessages(conv.messages);
    return normalized.length > 0 ? normalized : [createWelcomeMessage()];
  })(),
  createdAt: conv.createdAt || new Date(),
  updatedAt: conv.updatedAt || new Date(),
});
const loadLocalConversationsCache = () => {
  try {
    const raw = localStorage.getItem(LOCAL_CONVERSATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((conv, index) => normalizeConversation(conv, index));
  } catch (error) {
    console.warn('读取本地会话缓存失败:', error);
    return [];
  }
};
const saveLocalConversationsCache = (list) => {
  try {
    localStorage.setItem(LOCAL_CONVERSATIONS_KEY, JSON.stringify(list));
  } catch (error) {
    console.warn('保存本地会话缓存失败:', error);
  }
};
const createWelcomeMessage = () => ({
  id: 'welcome',
  role: 'model',
  text: '你好！我是武理小精灵 AI 助手 (Powered by Mimo)。有什么我可以帮你的吗？',
  timestamp: new Date(),
});

export const useChatStore = defineStore('chat', () => {
  // 延迟获取 authStore，避免循环依赖
  let skillStore = null;
  let authStore = null;

  const getAuthStore = () => {
    if (!authStore) {
      authStore = useAuthStore();
    }
    return authStore;
  };

  const getSkillStore = () => {
    if (!skillStore) {
      skillStore = useSkillStore();
    }
    return skillStore;
  };

  const conversations = ref([]);
  const currentConversationId = ref(localStorage.getItem(CURRENT_CONVERSATION_KEY) || '');
  const isLoading = ref(false);
  const currentStreamingId = ref(null);

  // 连接状态
  const isConnected = ref(true);
  const isReconnecting = ref(false);
  const reconnectAttempt = ref(0);

  // 数据加载状态
  const isLoaded = ref(false);

  // AbortController 用于取消正在进行的请求
  let currentAbortController = null;
  let activeStreamingConversationId = null;

  // 监听连接状态变化
  connectionManager.subscribe((event, data) => {
    if (event === 'connected') {
      isConnected.value = true;
      isReconnecting.value = false;
      reconnectAttempt.value = 0;
    } else if (event === 'disconnected') {
      isConnected.value = false;
    }
  });

  // 当前会话
  const currentConversation = computed(() =>
    conversations.value.find((c) => c.id === currentConversationId.value)
  );

  // 当前会话消息
  const messages = computed(() => currentConversation.value?.messages || [createWelcomeMessage()]);

  // 按更新时间排序的会话列表
  const sortedConversations = computed(() =>
    [...conversations.value].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  );

  // 加载会话列表
  const loadConversations = async () => {
    const auth = getAuthStore();
    // 如果用户未登录，或者是本地认证（无后端），初始化本地会话
    if (!auth.isAuthenticated || auth.isLocalAuth) {
      if (conversations.value.length === 0) {
        const cached = loadLocalConversationsCache();
        if (cached.length > 0) {
          conversations.value = cached;
          const hasCurrent = cached.some((c) => c.id === currentConversationId.value);
          currentConversationId.value = hasCurrent ? currentConversationId.value : cached[0].id;
        } else {
          conversations.value = [{ id: 'local', title: '本地会话', messages: [createWelcomeMessage()], createdAt: new Date(), updatedAt: new Date() }];
          currentConversationId.value = 'local';
        }
      }
      isLoaded.value = true;
      return;
    }

    try {
      const data = await fetchConversations();

      // 如果没有会话，创建一个默认会话
      if (data.length === 0) {
        const localConv = {
          id: `local_${Date.now()}`,
          title: '新会话',
          messages: [createWelcomeMessage()],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        conversations.value = [localConv];
        currentConversationId.value = localConv.id;
      } else {
        conversations.value = data.map((conv) => ({
          ...conv,
          messages: [], // 消息按需加载
        }));

        // 恢复当前会话ID
        if (currentConversationId.value && !conversations.value.find(c => c.id === currentConversationId.value)) {
          currentConversationId.value = conversations.value[0]?.id || '';
        }

        if (!currentConversationId.value && conversations.value.length > 0) {
          currentConversationId.value = conversations.value[0].id;
        }
      }

      isLoaded.value = true;
    } catch (error) {
      console.error('加载会话列表失败:', error);
      // 如果未登录或token失效，使用本地默认会话
      if (conversations.value.length === 0) {
        const cached = loadLocalConversationsCache();
        if (cached.length > 0) {
          conversations.value = cached;
          currentConversationId.value = cached.some((c) => c.id === currentConversationId.value)
            ? currentConversationId.value
            : cached[0].id;
        } else {
          conversations.value = [{ id: 'local', title: '本地会话', messages: [createWelcomeMessage()], createdAt: new Date(), updatedAt: new Date() }];
          currentConversationId.value = 'local';
        }
      }
      isLoaded.value = true;
    }
  };

  // 加载会话消息
  const loadConversationMessages = async (conversationId) => {
    // 本地会话或本地认证时不需要加载
    if (!conversationId || conversationId === 'local' || conversationId.startsWith('local_')) return;

    const auth = getAuthStore();
    if (auth.isLocalAuth) return;

    try {
      const conv = await fetchConversation(conversationId);
      const index = conversations.value.findIndex(c => c.id === conversationId);
      if (index !== -1 && conv) {
        const normalized = normalizeMessages(conv.messages);
        conversations.value[index].messages = normalized.length > 0 ? normalized : [createWelcomeMessage()];
        conversations.value[index].title = conv.title;
      }
    } catch (error) {
      console.error('加载会话消息失败:', error);
    }
  };

  // 创建会话
  const createConversation = async (title) => {
    const auth = getAuthStore();

    // 本地认证时直接创建本地会话
    if (auth.isLocalAuth) {
      const localConv = {
        id: `local_${Date.now()}`,
        title: title || `新会话 ${conversations.value.length + 1}`,
        messages: [createWelcomeMessage()],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      conversations.value.unshift(localConv);
      currentConversationId.value = localConv.id;
      return localConv.id;
    }

    try {
      const conv = await apiCreateConversation(title || `新会话 ${conversations.value.length + 1}`);
      conversations.value.unshift({
        ...conv,
        messages: [createWelcomeMessage()],
      });
      currentConversationId.value = conv.id;
      return conv.id;
    } catch (error) {
      console.error('创建会话失败:', error);
      // 本地回退
      const localConv = {
        id: `local_${Date.now()}`,
        title: title || `新会话 ${conversations.value.length + 1}`,
        messages: [createWelcomeMessage()],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      conversations.value.unshift(localConv);
      currentConversationId.value = localConv.id;
      return localConv.id;
    }
  };

  // 切换会话
  const switchConversation = async (id) => {
    if (!conversations.value.some((c) => c.id === id)) return;

    currentConversationId.value = id;
    localStorage.setItem(CURRENT_CONVERSATION_KEY, id);

    // 按需加载消息
    const conv = conversations.value.find(c => c.id === id);
    if (conv && (!conv.messages || conv.messages.length === 0)) {
      await loadConversationMessages(id);
    }
  };

  // 重命名会话
  const renameConversation = async (id, title) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    const conv = conversations.value.find(c => c.id === id);
    if (conv) {
      conv.title = trimmedTitle;
    }

    if (id !== 'local' && !id.startsWith('local_')) {
      const auth = getAuthStore();
      if (auth.isAuthenticated && !auth.isLocalAuth) {
        try {
          await apiRenameConversation(id, trimmedTitle);
        } catch (error) {
          console.error('重命名会话失败:', error);
        }
      }
    }
  };

  // 删除会话
  const deleteConversation = async (id) => {
    const targetIndex = conversations.value.findIndex((c) => c.id === id);
    if (targetIndex === -1) return;

    // 中止正在进行的请求
    if (activeStreamingConversationId === id && currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
      activeStreamingConversationId = null;
      currentStreamingId.value = null;
      isLoading.value = false;
    }

    conversations.value.splice(targetIndex, 1);

    // 后端删除（本地会话或未登录时跳过）
    if (id !== 'local' && !id.startsWith('local_')) {
      const auth = getAuthStore();
      if (auth.isAuthenticated && !auth.isLocalAuth) {
        try {
          await apiDeleteConversation(id);
        } catch (error) {
          console.error('删除会话失败:', error);
        }
      }
    }

    // 切换到其他会话
    if (currentConversationId.value === id) {
      if (conversations.value.length === 0) {
        await createConversation('默认会话');
      } else {
        currentConversationId.value = conversations.value[Math.max(0, targetIndex - 1)]?.id || conversations.value[0].id;
      }
    }
  };

  // 获取会话预览
  const getLastMessagePreview = (conversation) => {
    const lastMessage = [...(conversation.messages || [])]
      .reverse()
      .find((m) => m.id !== 'welcome' && getMessageText(m));
    if (!lastMessage) return '点击开始新对话';
    const text = getMessageText(lastMessage);
    return text.length > 22 ? `${text.slice(0, 22)}...` : text;
  };

  // 清空消息
  const clearMessages = async () => {
    const conv = currentConversation.value;
    if (!conv) return;

    conv.messages = [createWelcomeMessage()];

    if (conv.id !== 'local' && !conv.id.startsWith('local_')) {
      const auth = getAuthStore();
      if (auth.isAuthenticated && !auth.isLocalAuth) {
        try {
          await apiClearMessages(conv.id);
        } catch (error) {
          console.error('清空消息失败:', error);
        }
      }
    }
  };

  // 构建历史消息
  const buildHistory = (msgs, currentUserMessageId) => {
    const rawHistory = msgs
      .filter((m) => m.id !== 'welcome' && !m.isError && m.id !== currentUserMessageId && getMessageText(m))
      .slice(-20)
      .map((m) => ({ role: normalizeRole(m.role) === 'model' ? 'assistant' : normalizeRole(m.role), content: getMessageText(m) }));

    const history = [];
    let lastRole = '';
    for (const m of rawHistory) {
      if (m.role === lastRole && history.length > 0) history.pop();
      history.push(m);
      lastRole = m.role;
    }
    if (history.length > 0 && history[history.length - 1].role === 'user') history.pop();
    return history;
  };

  // 发送消息
  const sendMessage = async (text, enableRag = false, retryMsgId = null) => {
    const trimmedText = text.trim();
    let conv = currentConversation.value;

    // 如果没有当前会话，创建一个本地会话
    if (!conv) {
      conv = { id: 'local', title: '本地会话', messages: [createWelcomeMessage()], createdAt: new Date(), updatedAt: new Date() };
      conversations.value.push(conv);
      currentConversationId.value = conv.id;
    }

    if (!trimmedText || isLoading.value) return;

    const conversationId = conv.id;
    let convIndex = conversations.value.findIndex(c => c.id === conversationId);
    if (convIndex === -1) {
      conversations.value.push({
        ...conv,
        messages: normalizeMessages(conv.messages),
      });
      convIndex = conversations.value.findIndex(c => c.id === conversationId);
      if (convIndex === -1) return;
    }

    // 如果是重发，删除原来的失败消息
    let userMsg;
    if (retryMsgId) {
      const idx = conversations.value[convIndex].messages?.findIndex((m) => m.id === retryMsgId);
      if (idx > -1) {
        userMsg = conversations.value[convIndex].messages[idx];
        // 删除该消息及其后面的 AI 回复（如果有）
        conversations.value[convIndex].messages.splice(idx, 2);
      }
    }

    if (!userMsg) {
      userMsg = { id: createMessageId(), role: 'user', text: trimmedText, timestamp: new Date() };
      if (!conversations.value[convIndex].messages) conversations.value[convIndex].messages = [];
      conversations.value[convIndex].messages.push(userMsg);
    } else {
      // 重发时重新添加用户消息
      conversations.value[convIndex].messages.push(userMsg);
    }

    isLoading.value = true;
    activeStreamingConversationId = conversationId;
    currentAbortController = new AbortController();

    const history = buildHistory(conversations.value[convIndex].messages || [], userMsg.id);
    const skillPrompt = getSkillStore().buildSystemPrompt();
    const requestHistory = skillPrompt
      ? [{ role: 'system', content: skillPrompt }, ...history]
      : history;

    const aiMsgId = createMessageId();
    const aiMsg = { id: aiMsgId, role: 'model', text: '', timestamp: new Date(), sources: [] };
    conversations.value[convIndex].messages.push(aiMsg);
    currentStreamingId.value = aiMsgId;

    return new Promise((resolve) => {
      sendMessageStream(trimmedText, requestHistory, {
        onChunk: (content) => {
          // 使用响应式更新：找到消息索引并直接更新数组元素
          const msgs = conversations.value[convIndex]?.messages;
          if (msgs) {
            const msgIdx = msgs.findIndex((m) => m.id === aiMsgId);
            if (msgIdx !== -1) {
              // 创建新对象触发响应式更新
              msgs[msgIdx] = { ...msgs[msgIdx], text: msgs[msgIdx].text + content };
            }
          }
        },
        onSources: (sources) => {
          const msgs = conversations.value[convIndex]?.messages;
          if (msgs) {
            const msgIdx = msgs.findIndex((m) => m.id === aiMsgId);
            if (msgIdx !== -1) {
              msgs[msgIdx] = { ...msgs[msgIdx], sources };
            }
          }
        },
        onRetry: (attempt, maxRetries, delayMs) => {
          isReconnecting.value = true;
          reconnectAttempt.value = attempt;
        },
        onDone: () => {
          // 首次回答完成后，根据用户问题和 AI 回复生成标题
          const conv = conversations.value[convIndex];
          if (conv && (conv.title.startsWith('新会话') || conv.title === '默认会话')) {
            const userText = trimmedText;
            const aiMsg = conv.messages?.find(m => m.id === aiMsgId);
            const replyText = aiMsg?.text || '';
            if (userText) {
              conv.title = '正在生成标题...';
              const titleInput = `用户问题：${userText}\nAI回答：${replyText.slice(0, 200)}`;
              generateTitle(titleInput).then((title) => {
                conv.title = title;
                renameConversation(conversationId, title);
              });
            }
          }

          currentStreamingId.value = null;
          isLoading.value = false;
          isReconnecting.value = false;
          reconnectAttempt.value = 0;
          activeStreamingConversationId = null;
          currentAbortController = null;
          resolve();
        },
        onError: () => {
          const msgs = conversations.value[convIndex]?.messages;
          if (msgs) {
            const msgIdx = msgs.findIndex((m) => m.id === aiMsgId);
            if (msgIdx !== -1 && !msgs[msgIdx].text) {
              msgs[msgIdx] = {
                ...msgs[msgIdx],
                text: '抱歉，连接服务器失败，请检查后端服务是否启动。',
                isError: true
              };
            }
            // 标记用户消息可重发
            const userIdx = msgs.findIndex((m) => m.id === userMsg.id);
            if (userIdx !== -1) {
              msgs[userIdx] = { ...msgs[userIdx], canRetry: true };
            }
          }

          currentStreamingId.value = null;
          isLoading.value = false;
          isReconnecting.value = false;
          activeStreamingConversationId = null;
          currentAbortController = null;
          resolve();
        },
        onAbort: () => {
          currentStreamingId.value = null;
          isLoading.value = false;
          isReconnecting.value = false;
          activeStreamingConversationId = null;
          currentAbortController = null;
          resolve();
        },
      }, {
        signal: currentAbortController.signal,
        conversationId,
        enableRag,
      });
    });
  };

  // 重发消息
  const retryMessage = async (msgId) => {
    const conv = currentConversation.value;
    if (!conv) return;

    const msg = conv.messages?.find((m) => m.id === msgId);
    if (!msg || msg.role !== 'user' || !msg.canRetry) return;

    // 清除重发标记
    msg.canRetry = false;

    // 重新发送
    await sendMessage(getMessageText(msg), false, msgId);
  };

  // 获取会话历史
  const getConversationHistory = () =>
    messages.value.filter((m) => m.id !== 'welcome' && !m.isError).map((m) => ({
      role: m.role,
      content: getMessageText(m),
      timestamp: m.timestamp,
    }));

  // 删除消息
  const deleteMessage = (id) => {
    const conv = currentConversation.value;
    if (!conv || id === 'welcome') return;
    const index = conv.messages?.findIndex((m) => m.id === id);
    if (index > -1) conv.messages.splice(index, 1);
  };

  // 中止当前请求
  const abortCurrentRequest = () => {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
      activeStreamingConversationId = null;
      currentStreamingId.value = null;
      isLoading.value = false;
    }
  };

  // 保存本地会话缓存（防抖）
  let saveTimer = null;
  const scheduleSaveCache = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const auth = getAuthStore();
      if (!auth.isAuthenticated || auth.isLocalAuth) {
        saveLocalConversationsCache(conversations.value);
      }
      saveTimer = null;
    }, 500);
  };

  // 监听会话列表结构变化（数量、顺序），不监听消息内容
  watch(() => conversations.value.map(c => c.id).join(','), () => {
    scheduleSaveCache();
  });

  watch(currentConversationId, (value) => {
    localStorage.setItem(CURRENT_CONVERSATION_KEY, value);
    scheduleSaveCache();
  });

  return {
    conversations,
    currentConversationId,
    currentConversation,
    sortedConversations,
    messages,
    isLoading,
    currentStreamingId,
    isConnected,
    isReconnecting,
    reconnectAttempt,
    isLoaded,
    loadConversations,
    loadConversationMessages,
    createConversation,
    switchConversation,
    renameConversation,
    deleteConversation,
    getLastMessagePreview,
    sendMessage,
    retryMessage,
    clearMessages,
    getConversationHistory,
    deleteMessage,
    abortCurrentRequest,
  };
});





