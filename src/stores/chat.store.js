import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { sendMessageStream } from '../api/chat.js';
import { useSkillStore } from './skill.store.js';

const STORAGE_KEY = 'chat_conversations';
const CURRENT_CONVERSATION_KEY = 'chat_current_conversation_id';
const LEGACY_STORAGE_KEY = 'chat_messages';
const MAX_SAVED_MESSAGES = 100;

const createMessageId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createConversationId = () => `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createWelcomeMessage = () => ({
  id: 'welcome',
  role: 'model',
  text: '你好！我是武理小精灵 AI 助手 (Powered by Qwen)。有什么我可以帮你的吗？',
  timestamp: new Date(),
});
const createConversationTitle = (messages, fallbackIndex) => {
  const firstUserMessage = messages.find((message) => message.role === 'user' && message.text.trim());
  if (firstUserMessage) return firstUserMessage.text.trim().slice(0, 18) || `新会话 ${fallbackIndex}`;
  return `新会话 ${fallbackIndex}`;
};
const createEmptyConversation = (title) => {
  const now = new Date();
  return { id: createConversationId(), title: title || '新会话', messages: [createWelcomeMessage()], createdAt: now, updatedAt: now };
};
const normalizeMessage = (message) => ({
  id: String(message.id ?? createMessageId()),
  role: message.role === 'user' ? 'user' : 'model',
  text: String(message.text ?? ''),
  timestamp: new Date(message.timestamp ?? Date.now()),
  isError: Boolean(message.isError),
});
const normalizeConversation = (conversation, index) => {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages.map(normalizeMessage).slice(-MAX_SAVED_MESSAGES) : [createWelcomeMessage()];
  const safeMessages = messages.length > 0 ? messages : [createWelcomeMessage()];
  return {
    id: String(conversation?.id ?? createConversationId()),
    title: String(conversation?.title ?? createConversationTitle(safeMessages, index + 1)),
    messages: safeMessages,
    createdAt: new Date(conversation?.createdAt ?? Date.now()),
    updatedAt: new Date(conversation?.updatedAt ?? Date.now()),
  };
};
const loadConversations = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((conversation, index) => normalizeConversation(conversation, index));
      }
    }
    const legacyStored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyStored) {
      const parsed = JSON.parse(legacyStored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const legacyConversation = normalizeConversation({
          id: createConversationId(),
          title: createConversationTitle(parsed.map(normalizeMessage), 1),
          messages: parsed,
          createdAt: parsed[0]?.timestamp ?? Date.now(),
          updatedAt: parsed[parsed.length - 1]?.timestamp ?? Date.now(),
        }, 0);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        return [legacyConversation];
      }
    }
  } catch (error) {
    console.error('Failed to load conversations from localStorage:', error);
  }
  return [createEmptyConversation('默认会话')];
};

export const useChatStore = defineStore('chat', () => {
  const skillStore = useSkillStore();
  const conversations = ref(loadConversations());
  const currentConversationId = ref(localStorage.getItem(CURRENT_CONVERSATION_KEY) || conversations.value[0]?.id || createConversationId());
  const isLoading = ref(false);
  const currentStreamingId = ref(null);

  if (!conversations.value.some((conversation) => conversation.id === currentConversationId.value)) {
    currentConversationId.value = conversations.value[0]?.id || '';
  }

  const currentConversation = computed(() => conversations.value.find((conversation) => conversation.id === currentConversationId.value));
  const messages = computed(() => currentConversation.value?.messages || []);
  const sortedConversations = computed(() => [...conversations.value].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()));

  watch(conversations, () => {
    try {
      const normalized = conversations.value.map((conversation) => ({ ...conversation, messages: conversation.messages.slice(-MAX_SAVED_MESSAGES) }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch (error) {
      console.error('Failed to save conversations to localStorage:', error);
    }
  }, { deep: true });

  watch(currentConversationId, (value) => localStorage.setItem(CURRENT_CONVERSATION_KEY, value));

  const updateConversation = (conversationId, updater) => {
    const conversation = conversations.value.find((item) => item.id === conversationId);
    if (!conversation) return;
    updater(conversation);
    conversation.updatedAt = new Date();
  };

  const createConversation = (title) => {
    const conversation = createEmptyConversation(title || `新会话 ${conversations.value.length + 1}`);
    conversations.value.unshift(conversation);
    currentConversationId.value = conversation.id;
    return conversation.id;
  };

  const switchConversation = (id) => {
    if (conversations.value.some((conversation) => conversation.id === id)) currentConversationId.value = id;
  };

  const renameConversation = (id, title) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    updateConversation(id, (conversation) => {
      conversation.title = trimmedTitle;
    });
  };

  const deleteConversation = (id) => {
    const targetIndex = conversations.value.findIndex((conversation) => conversation.id === id);
    if (targetIndex === -1) return;
    conversations.value.splice(targetIndex, 1);
    if (conversations.value.length === 0) {
      const newId = createConversation('默认会话');
      currentConversationId.value = newId;
      return;
    }
    if (currentConversationId.value === id) {
      currentConversationId.value = conversations.value[Math.max(0, targetIndex - 1)]?.id || conversations.value[0].id;
    }
  };

  const getLastMessagePreview = (conversation) => {
    const lastMessage = [...conversation.messages].reverse().find((message) => message.id !== 'welcome' && message.text.trim());
    if (!lastMessage) return '点击开始新对话';
    return lastMessage.text.length > 22 ? `${lastMessage.text.slice(0, 22)}...` : lastMessage.text;
  };

  const clearMessages = () => {
    const activeConversation = currentConversation.value;
    if (!activeConversation) return;
    updateConversation(activeConversation.id, (conversation) => {
      conversation.messages = [createWelcomeMessage()];
    });
  };

  const buildHistory = (conversationMessages, currentUserMessageId) => {
    const rawHistory = conversationMessages
      .filter((message) => message.id !== 'welcome' && !message.isError && message.id !== currentUserMessageId && message.text.trim())
      .slice(-20)
      .map((message) => ({ role: message.role === 'model' ? 'assistant' : message.role, content: message.text }));

    const history = [];
    let lastRole = '';
    for (const message of rawHistory) {
      if (message.role === lastRole && history.length > 0) history.pop();
      history.push(message);
      lastRole = message.role;
    }
    if (history.length > 0 && history[history.length - 1].role === 'user') history.pop();
    return history;
  };

  const sendMessage = async (text) => {
    const trimmedText = text.trim();
    const activeConversation = currentConversation.value;
    if (!trimmedText || isLoading.value || !activeConversation) return;

    const conversationId = activeConversation.id;
    const userMsg = { id: createMessageId(), role: 'user', text: trimmedText, timestamp: new Date() };

    updateConversation(conversationId, (conversation) => {
      conversation.messages.push(userMsg);
      if ((conversation.title.startsWith('新会话') || conversation.title === '默认会话') && conversation.messages.filter((message) => message.role === 'user').length === 1) {
        conversation.title = createConversationTitle(conversation.messages, conversations.value.length);
      }
    });

    isLoading.value = true;
    const history = buildHistory(currentConversation.value?.messages || [], userMsg.id);
    const skillPrompt = skillStore.buildSystemPrompt();
    const requestHistory = skillPrompt
      ? [{ role: 'system', content: skillPrompt }, ...history]
      : history;
    const aiMsgId = createMessageId();
    const aiMsg = { id: aiMsgId, role: 'model', text: '', timestamp: new Date() };

    updateConversation(conversationId, (conversation) => {
      conversation.messages.push(aiMsg);
    });
    currentStreamingId.value = aiMsgId;

    return new Promise((resolve) => {
      sendMessageStream(trimmedText, requestHistory, {
        onChunk: (content) => updateConversation(conversationId, (conversation) => {
          const message = conversation.messages.find((item) => item.id === aiMsgId);
          if (message) message.text += content;
        }),
        onDone: () => {
          currentStreamingId.value = null;
          isLoading.value = false;
          resolve();
        },
        onError: () => {
          updateConversation(conversationId, (conversation) => {
            const message = conversation.messages.find((item) => item.id === aiMsgId);
            if (message && !message.text) {
              message.text = '抱歉，连接服务器失败，请检查后端服务是否启动。';
              message.isError = true;
            }
          });
          currentStreamingId.value = null;
          isLoading.value = false;
          resolve();
        },
      });
    });
  };

  const getConversationHistory = () => messages.value.filter((message) => message.id !== 'welcome' && !message.isError).map((message) => ({ role: message.role, content: message.text, timestamp: message.timestamp }));

  const deleteMessage = (id) => {
    const activeConversation = currentConversation.value;
    if (!activeConversation || id === 'welcome') return;
    updateConversation(activeConversation.id, (conversation) => {
      const index = conversation.messages.findIndex((message) => message.id === id);
      if (index > -1) conversation.messages.splice(index, 1);
    });
  };

  return { conversations, currentConversationId, currentConversation, sortedConversations, messages, isLoading, currentStreamingId, createConversation, switchConversation, renameConversation, deleteConversation, getLastMessagePreview, sendMessage, clearMessages, getConversationHistory, deleteMessage };
});
