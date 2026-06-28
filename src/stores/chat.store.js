import { defineStore } from 'pinia';
import { computed, watch } from 'vue';
import { useConversationStore } from './conversation.store.js';
import { useMessageStore } from './message.store.js';

/**
 * Chat Store - 组合会话和消息管理
 *
 * 这是一个组合 store，整合了 conversationStore 和 messageStore 的功能，
 * 保持向后兼容性的同时提供更好的代码组织。
 */
export const useChatStore = defineStore('chat', () => {
  const conversationStore = useConversationStore();
  const messageStore = useMessageStore();

  // 监听会话变化，触发缓存保存
  watch(
    () => conversationStore.conversations.map((c) => c.id).join(','),
    () => {
      conversationStore.scheduleSaveCache();
    }
  );

  watch(
    () => conversationStore.currentConversationId,
    (value) => {
      localStorage.setItem('chat_current_conversation_id', value);
      conversationStore.scheduleSaveCache();
    }
  );

  // 计算属性 - 代理到 conversationStore
  const conversations = computed(() => conversationStore.conversations);
  const currentConversationId = computed(() => conversationStore.currentConversationId);
  const currentConversation = computed(() => conversationStore.currentConversation);
  const sortedConversations = computed(() => conversationStore.sortedConversations);
  const messages = computed(() => {
    const conv = conversationStore.currentConversation;
    return conv?.messages || [];
  });
  const isLoaded = computed(() => conversationStore.isLoaded);

  // 状态 - 代理到 messageStore
  const isLoading = computed(() => messageStore.isLoading);
  const currentStreamingId = computed(() => messageStore.currentStreamingId);
  const isConnected = computed(() => messageStore.isConnected);
  const isReconnecting = computed(() => messageStore.isReconnecting);
  const reconnectAttempt = computed(() => messageStore.reconnectAttempt);

  // 方法 - 代理到 conversationStore
  const loadConversations = () => conversationStore.loadConversations();
  const loadConversationMessages = (id) => conversationStore.loadConversationMessages(id);
  const createConversation = (title) => conversationStore.createConversation(title);
  const switchConversation = (id) => conversationStore.switchConversation(id);
  const renameConversation = (id, title) => conversationStore.renameConversation(id, title);
  const deleteConversation = (id) => {
    // 如果正在删除的会话有流式传输，先中止
    if (messageStore.isLoading && conversationStore.currentConversationId === id) {
      messageStore.abortCurrentRequest();
    }
    return conversationStore.deleteConversation(id);
  };
  const getLastMessagePreview = (conv) => conversationStore.getLastMessagePreview(conv);

  // 方法 - 代理到 messageStore
  const sendMessage = (text, retryMsgId, fileData) => messageStore.sendMessage(text, retryMsgId, fileData);
  const retryMessage = (msgId) => messageStore.retryMessage(msgId);
  const clearMessages = () => messageStore.clearMessages();
  const getConversationHistory = () => messageStore.getConversationHistory();
  const deleteMessage = (id) => messageStore.deleteMessage(id);
  const abortCurrentRequest = () => messageStore.abortCurrentRequest();

  return {
    // 会话状态
    conversations,
    currentConversationId,
    currentConversation,
    sortedConversations,
    messages,
    isLoaded,

    // 消息状态
    isLoading,
    currentStreamingId,
    isConnected,
    isReconnecting,
    reconnectAttempt,

    // 会话方法
    loadConversations,
    loadConversationMessages,
    createConversation,
    switchConversation,
    renameConversation,
    deleteConversation,
    getLastMessagePreview,

    // 消息方法
    sendMessage,
    retryMessage,
    clearMessages,
    getConversationHistory,
    deleteMessage,
    abortCurrentRequest,
  };
});
