/**
 * useMessageActions — 消息操作 composable
 *
 * 处理消息删除、清空、获取历史等操作
 */

import { useConversationStore } from '../stores/conversation.store.js';
import { clearConversationMessages } from '../api/conversations.js';

export function useMessageActions() {
  const deleteMessage = (id) => {
    const convStore = useConversationStore();
    const conv = convStore.currentConversation;
    if (!conv || id === 'welcome') return;
    const index = conv.messages?.findIndex((m) => m.id === id);
    if (index > -1) {
      conv.messages.splice(index, 1);
      convStore.unregisterMessage(id);
      convStore.scheduleSaveCache(true);
    }
  };

  const setMessageFeedback = (id, feedback) => {
    const convStore = useConversationStore();
    const conv = convStore.currentConversation;
    if (!conv || id === 'welcome') return;
    const index = conv.messages?.findIndex((m) => m.id === id);
    if (index > -1) {
      conv.messages[index] = {
        ...conv.messages[index],
        feedback,
      };
      // 消息对象被替换（spread），重新注册以更新引用
      convStore.registerMessage(conv.id, conv.messages[index]);
      convStore.scheduleSaveCache(true);
    }
  };

  const clearMessages = async () => {
    const convStore = useConversationStore();
    const conv = convStore.currentConversation;
    if (!conv) return;

    // 清空消息前，先 unregister 旧消息（保留欢迎消息）
    for (const msg of conv.messages) {
      if (msg.id !== 'welcome') convStore.unregisterMessage(msg.id);
    }

    // 清空消息：保留欢迎消息
    conv.messages = [{ id: 'welcome', role: 'model', content: '你好！我是武理小精灵，你的校园 AI 助手。有什么我可以帮你的吗？', timestamp: new Date() }];
    convStore.scheduleSaveCache(true);

    if (!convStore.isLocalSession(conv.id) && convStore.isBackendAvailable()) {
      try {
        await clearConversationMessages(conv.id);
      } catch (error) {
        console.error('清空消息失败:', error);
      }
    }
  };

  const getConversationHistory = () => {
    const convStore = useConversationStore();
    const messages = convStore.currentConversation?.messages || [];
    return messages
      .filter((m) => m.id !== 'welcome' && !m.isError)
      .map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      }));
  };

  return {
    deleteMessage,
    setMessageFeedback,
    clearMessages,
    getConversationHistory,
  };
}
