import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useStreaming } from '../composables/useStreaming.js';
import { useMessageActions } from '../composables/useMessageActions.js';

export const useMessageStore = defineStore('message', () => {
  const streaming = useStreaming();
  const actions = useMessageActions();

  return {
    // 流式状态（由 useStreaming 管理）
    isLoading: streaming.isLoading,
    currentStreamingId: streaming.currentStreamingId,
    isConnected: streaming.isConnected,
    isReconnecting: streaming.isReconnecting,
    reconnectAttempt: streaming.reconnectAttempt,

    // 流式操作
    sendMessage: streaming.sendMessage,
    retryMessage: streaming.retryMessage,
    abortCurrentRequest: streaming.abortCurrentRequest,

    // 消息操作
    deleteMessage: actions.deleteMessage,
    clearMessages: actions.clearMessages,
    getConversationHistory: actions.getConversationHistory,
  };
});
