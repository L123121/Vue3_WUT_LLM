import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useConversationStore } from './conversation.store.js';

/**
 * 消息收藏 store — localStorage 持久化
 *
 * 收藏条目：{ id, conversationId, conversationTitle, messageId, role, text, timestamp, createdAt }
 * 侧边栏收藏夹点击后，通过 pendingScrollMessageId 通知 AIChat 滚动定位到该消息。
 * conversationTitle 仅作快照兜底：展示时优先取会话 store 的实时标题（会话 store 是标题的唯一事实来源）。
 */

const STORAGE_KEY = 'chat_favorites';

function loadFavorites() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[Favorites] 读取收藏失败:', err.message);
    return [];
  }
}

export const useFavoritesStore = defineStore('favorites', () => {
  const favorites = ref(loadFavorites());
  // 待滚动定位的消息 id（侧边栏收藏夹 → AIChat）
  const pendingScrollMessageId = ref('');

  const sortedFavorites = computed(() => {
    // 会话标题的唯一事实来源是 conversation store，收藏条目里的 conversationTitle 只是快照兜底
    const conversationStore = useConversationStore();
    const liveTitles = new Map(conversationStore.conversations.map((c) => [c.id, c.title]));
    return [...favorites.value]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((fav) => ({
        ...fav,
        conversationTitle: liveTitles.get(fav.conversationId) || fav.conversationTitle || '对话',
      }));
  });

  const isFavorite = (messageId) => favorites.value.some((f) => f.messageId === messageId);

  const persist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites.value));
    } catch (err) {
      console.warn('[Favorites] 保存收藏失败:', err.message);
    }
  };

  const toggleFavorite = (message, conversation) => {
    const existingIndex = favorites.value.findIndex((f) => f.messageId === message.id);
    if (existingIndex >= 0) {
      favorites.value.splice(existingIndex, 1);
    } else {
      favorites.value.push({
        id: `${message.id}_fav_${Date.now()}`,
        conversationId: conversation?.id || '',
        conversationTitle: conversation?.title || '对话',
        messageId: message.id,
        role: message.role,
        text: message.text || message.content || '',
        timestamp: message.timestamp || new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
    }
    persist();
  };

  const removeFavorite = (favoriteId) => {
    favorites.value = favorites.value.filter((f) => f.id !== favoriteId);
    persist();
  };

  // 请求滚动定位到指定消息（跨组件通信：收藏夹 → 聊天页）
  const requestScrollToMessage = (messageId) => {
    pendingScrollMessageId.value = messageId;
  };

  const consumeScrollRequest = () => {
    const id = pendingScrollMessageId.value;
    pendingScrollMessageId.value = '';
    return id;
  };

  return {
    favorites,
    sortedFavorites,
    pendingScrollMessageId,
    isFavorite,
    toggleFavorite,
    removeFavorite,
    requestScrollToMessage,
    consumeScrollRequest,
  };
});
