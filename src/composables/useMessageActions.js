/**
 * useMessageActions — 消息操作 composable
 *
 * 处理消息删除、清空、获取历史等操作
 */

import { useConversationStore } from '../stores/conversation.store.js';

export function useMessageActions() {
  const deleteMessage = (id) => {
    const convStore = useConversationStore();
    const conv = convStore.currentConversation;
    if (!conv || id === 'welcome') return;
    const index = conv.messages?.findIndex((m) => m.id === id);
    if (index > -1) {
      conv.messages.splice(index, 1);
      convStore.scheduleSaveCache(true);
    }
  };

  const clearMessages = async () => {
    const convStore = useConversationStore();
    const conv = convStore.currentConversation;
    if (!conv) return;
    conv.messages = [{ id: 'welcome', role: 'model', content: '你好！我是武理小精灵 AI 助手 (Powered by Qwen)。有什么我可以帮你的吗？', timestamp: new Date() }];
    convStore.scheduleSaveCache(true);

    if (!convStore.isLocalSession(conv.id) && convStore.isBackendAvailable()) {
      try {
        const { clearConversationMessages } = await import('../api/conversations.js');
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
    clearMessages,
    getConversationHistory,
  };
}
