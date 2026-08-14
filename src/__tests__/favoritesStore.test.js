import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useFavoritesStore } from '../stores/favorites.store.js';
import { useConversationStore } from '../stores/conversation.store.js';

vi.mock('../api/conversations.js', () => ({
  fetchConversations: vi.fn().mockResolvedValue([]),
  createConversation: vi.fn(),
  fetchConversation: vi.fn(),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
  saveConversationMessages: vi.fn(),
  clearConversationMessages: vi.fn(),
}));

describe('favoritesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('收藏条目展示会话最新标题（重命名后实时同步）', async () => {
    const conversationStore = useConversationStore();
    const favoritesStore = useFavoritesStore();

    const convId = await conversationStore.createConversation('旧标题');
    favoritesStore.toggleFavorite(
      { id: 'msg_1', role: 'assistant', text: '答案内容' },
      { id: convId, title: '旧标题' }
    );

    expect(favoritesStore.sortedFavorites[0].conversationTitle).toBe('旧标题');

    await conversationStore.renameConversation(convId, '新标题');

    expect(favoritesStore.sortedFavorites[0].conversationTitle).toBe('新标题');
  });

  it('会话不存在时回退到收藏时快照标题', () => {
    const favoritesStore = useFavoritesStore();
    // conversationId 指向已不存在的会话（如已被删除），应回退展示收藏时的快照标题。
    // 不通过 createConversation/deleteConversation 构造，因为 local_ 会话 id 基于 Date.now()，
    // 删除后自动补建的「默认会话」可能与收藏的 conversationId 落在同一毫秒产生 id 碰撞，导致断言不稳定。
    favoritesStore.toggleFavorite(
      { id: 'msg_2', role: 'assistant', text: '答案' },
      { id: 'deleted-conv-id', title: '已被删除的会话' }
    );

    expect(favoritesStore.sortedFavorites[0].conversationTitle).toBe('已被删除的会话');
  });
});
