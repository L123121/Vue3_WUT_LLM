import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useChatStore } from '../stores/chat.store.js';
import { useAuthStore } from '../stores/auth.store.js';
import * as conversationsApi from '../api/conversations.js';

// Mock the API modules
vi.mock('../api/chat.js', () => ({
  sendMessageStream: vi.fn(),
  connectionManager: {
    subscribe: vi.fn(() => () => {}),
    isConnected: true,
  },
}));

vi.mock('../api/conversations.js', () => ({
  fetchConversations: vi.fn().mockResolvedValue([]),
  createConversation: vi.fn(),
  fetchConversation: vi.fn(),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
  saveConversationMessages: vi.fn(),
  clearConversationMessages: vi.fn(),
}));

describe('chatStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(conversationsApi.fetchConversations).mockResolvedValue([]);
    vi.mocked(conversationsApi.createConversation).mockResolvedValue({
      id: 'conv_created',
      title: '新会话',
      messages: [],
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
    });
    vi.mocked(conversationsApi.fetchConversation).mockResolvedValue(null);
    vi.mocked(conversationsApi.deleteConversation).mockResolvedValue(true);
    vi.mocked(conversationsApi.saveConversationMessages).mockResolvedValue(true);
  });

  it('initializes with empty state', () => {
    const store = useChatStore();
    expect(store.conversations).toEqual([]);
    expect(store.isLoading).toBe(false);
    expect(store.currentStreamingId).toBeNull();
  });

  it('creates a local conversation', async () => {
    const store = useChatStore();
    const id = await store.createConversation('Test Chat');

    expect(id).toMatch(/^local_/);
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0].title).toBe('Test Chat');
    expect(store.conversations[0].messages[0].id).toBe('welcome');
  });

  it('switches conversation', async () => {
    const store = useChatStore();
    const id1 = await store.createConversation('Chat 1');
    const id2 = await store.createConversation('Chat 2');

    await store.switchConversation(id1);
    expect(store.currentConversationId).toBe(id1);
  });

  it('deletes conversation and switches to another', async () => {
    const store = useChatStore();
    const id1 = await store.createConversation('Chat 1');
    const id2 = await store.createConversation('Chat 2');

    await store.deleteConversation(id2);
    expect(store.conversations).toHaveLength(1);
    expect(store.currentConversationId).toBe(id1);
  });

  it('creates default conversation when all deleted', async () => {
    const store = useChatStore();
    await store.createConversation('Only Chat');
    await store.deleteConversation(store.conversations[0].id);

    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0].title).toBe('默认会话');
  });

  it('restores cached conversations when backend is unavailable', async () => {
    // 未登录 → 游客命名空间
    localStorage.setItem('chat_cache:guest', JSON.stringify({
      version: 1,
      currentId: 'local_cached',
      conversations: [{
        id: 'local_cached',
        title: 'Cached Chat',
        messages: [{ id: 'cached-message', role: 'user', content: 'hello' }],
        createdAt: '2026-08-17T00:00:00.000Z',
        updatedAt: '2026-08-17T00:00:00.000Z',
      }],
    }));

    const store = useChatStore();
    await store.loadConversations();

    expect(store.currentConversationId).toBe('local_cached');
    expect(store.conversations[0].title).toBe('Cached Chat');
    expect(store.conversations[0].messages[0].id).toBe('cached-message');
  });

  it('removes stale server conversations while migrating local-only conversations', async () => {
    localStorage.setItem('chat_cache:user-1', JSON.stringify({
      version: 1,
      currentId: 'conv_stale',
      conversations: [
        { id: 'conv_stale', title: 'Stale', messages: [], updatedAt: '2026-08-17T00:00:00.000Z' },
        { id: 'local_keep', title: 'Local', messages: [], updatedAt: '2026-08-17T00:00:00.000Z' },
      ],
    }));
    useAuthStore().setUser({ id: 'user-1', name: 'User' });
    vi.mocked(conversationsApi.fetchConversations).mockResolvedValue([
      { id: 'conv_server', title: 'Server', messages: [], updatedAt: '2026-08-17T01:00:00.000Z' },
    ]);

    const store = useChatStore();
    await store.loadConversations();

    expect(store.conversations.map((conv) => conv.id)).toEqual(['conv_server', 'conv_created']);
    expect(store.currentConversationId).toBe('conv_server');
  });

  it('keeps cached server conversations when the list request fails', async () => {
    localStorage.setItem('chat_cache:user-1', JSON.stringify({
      version: 1,
      currentId: 'conv_cached',
      conversations: [
        { id: 'conv_cached', title: 'Offline Cache', messages: [], updatedAt: '2026-08-17T00:00:00.000Z' },
      ],
    }));
    useAuthStore().setUser({ id: 'user-1', name: 'User' });
    vi.mocked(conversationsApi.fetchConversations).mockResolvedValue(null);

    const store = useChatStore();
    await store.loadConversations();

    expect(store.conversations).toHaveLength(1);
    expect(store.currentConversationId).toBe('conv_cached');
  });

  it('creates a server conversation for an authenticated account with no history', async () => {
    useAuthStore().setUser({ id: 'user-1', name: 'User' });
    vi.mocked(conversationsApi.createConversation).mockResolvedValue({
      id: 'conv_initial',
      title: '新会话',
      messages: [],
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
    });

    const store = useChatStore();
    await store.loadConversations();

    expect(conversationsApi.createConversation).toHaveBeenCalledWith('新会话');
    expect(store.currentConversationId).toBe('conv_initial');
    expect(store.conversations[0].id).toBe('conv_initial');
    expect(store.conversations[0].messages[0].id).toBe('welcome');
  });

  it('migrates a local conversation before account logout', async () => {
    const store = useChatStore();
    const localId = await store.createConversation('待同步会话');
    store.conversations[0].messages.push({ id: 'local-message', role: 'user', content: '保留我' });

    useAuthStore().setUser({ id: 'user-1', name: 'User' });
    vi.mocked(conversationsApi.createConversation).mockResolvedValue({
      id: 'conv_migrated',
      title: '待同步会话',
      messages: [],
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
    });

    const synced = await store.flushPendingChanges();

    expect(synced).toBe(true);
    expect(conversationsApi.createConversation).toHaveBeenCalledWith('待同步会话');
    expect(conversationsApi.saveConversationMessages).toHaveBeenCalledWith(
      'conv_migrated',
      expect.arrayContaining([expect.objectContaining({ id: 'local-message' })])
    );
    expect(store.currentConversationId).toBe('conv_migrated');
    expect(store.conversations.some((conv) => conv.id === localId)).toBe(false);
  });

  it('keeps persisted cache on account reset and clears it only via clearPersistedCache', async () => {
    useAuthStore().setUser({ id: 'user-1', name: 'User' });
    const store = useChatStore();
    await store.loadConversations();
    await store.createConversation('Private Chat');
    expect(store.isLoaded).toBe(true);
    // 确认缓存已写入当前用户命名空间
    expect(localStorage.getItem('chat_cache:user-1')).not.toBeNull();

    store.resetConversationState();

    expect(store.conversations).toEqual([]);
    expect(store.currentConversationId).toBe('');
    expect(store.isLoaded).toBe(false);
    expect(localStorage.getItem('chat_current_conversation_id')).toBeNull();
    // 缓存必须保留：里面可能有同步失败期间未上传的消息（唯一副本），等下次登录迁移
    expect(localStorage.getItem('chat_cache:user-1')).not.toBeNull();

    // 仅登出流程（同步成功后）调用 clearPersistedCache 才清理
    store.clearPersistedCache();
    expect(localStorage.getItem('chat_cache:user-1')).toBeNull();
  });

  it('does not wipe cache with an empty conversation list during reset', async () => {
    useAuthStore().setUser({ id: 'user-1', name: 'User' });
    const store = useChatStore();
    await store.loadConversations();
    await store.createConversation('Chat');
    const cachedBefore = localStorage.getItem('chat_cache:user-1');
    expect(cachedBefore).not.toBeNull();

    // 重置把内存列表清空，chat.store 的 watcher 会触发一次空列表的 scheduleSaveCache；
    // 空列表不得覆盖缓存，否则未同步消息被清掉
    store.resetConversationState();
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(localStorage.getItem('chat_cache:user-1')).toBe(cachedBefore);
  });

  it('keeps longer local messages over shorter server messages on reload', async () => {
    useAuthStore().setUser({ id: 'user-1', name: 'User' });
    // 服务端只同步到 1 条用户消息（同步失败场景），本地缓存里有 3 条（含未上传的 AI 回复）
    vi.mocked(conversationsApi.fetchConversations).mockResolvedValue([
      { id: 'conv_synced', title: '同步中断会话', messages: [], updatedAt: '2026-08-17T00:00:00.000Z' },
    ]);
    vi.mocked(conversationsApi.fetchConversation).mockResolvedValue({
      id: 'conv_synced',
      title: '同步中断会话',
      messages: [{ id: 'm-user-1', role: 'user', content: '第一条' }],
    });

    const store = useChatStore();
    await store.loadConversations();
    // 模拟缓存中恢复了完整的本地消息（含未同步尾部）
    store.conversations[0].messages = [
      { id: 'welcome', role: 'model', content: '你好' },
      { id: 'm-user-1', role: 'user', content: '第一条' },
      { id: 'm-ai-1', role: 'model', content: '未同步的回复' },
    ];

    await store.loadConversationMessages('conv_synced');

    // 本地更长 → 保留本地未同步消息，不被服务端旧状态覆盖
    const msgs = store.conversations[0].messages;
    expect(msgs.map((m) => m.id)).toEqual(['welcome', 'm-user-1', 'm-ai-1']);
  });

  it('prefers server messages when the server has more on reload', async () => {
    useAuthStore().setUser({ id: 'user-1', name: 'User' });
    vi.mocked(conversationsApi.fetchConversations).mockResolvedValue([
      { id: 'conv_multi', title: '多端会话', messages: [], updatedAt: '2026-08-17T00:00:00.000Z' },
    ]);
    // 其他端新增过消息：服务端 3 条 > 本地缓存 2 条
    vi.mocked(conversationsApi.fetchConversation).mockResolvedValue({
      id: 'conv_multi',
      title: '多端会话',
      messages: [
        { id: 'm-user-1', role: 'user', content: '第一条' },
        { id: 'm-ai-1', role: 'model', content: '回复一' },
        { id: 'm-user-2', role: 'user', content: '第二条（其他端发的）' },
      ],
    });

    const store = useChatStore();
    await store.loadConversations();

    await store.loadConversationMessages('conv_multi');

    const msgs = store.conversations[0].messages;
    expect(msgs.map((m) => m.id)).toEqual(['m-user-1', 'm-ai-1', 'm-user-2']);
  });

  it('renames conversation', async () => {
    const store = useChatStore();
    await store.createConversation('Old Name');
    const id = store.conversations[0].id;

    await store.renameConversation(id, '  New Name  ');
    expect(store.conversations[0].title).toBe('New Name');
  });

  it('ignores empty rename', async () => {
    const store = useChatStore();
    await store.createConversation('Keep');
    const id = store.conversations[0].id;

    await store.renameConversation(id, '   ');
    expect(store.conversations[0].title).toBe('Keep');
  });

  it('clears messages to welcome only', async () => {
    const store = useChatStore();
    await store.createConversation('Chat');
    // Manually add a message
    store.conversations[0].messages.push({ id: 'test', role: 'user', text: 'hi', timestamp: new Date() });

    await store.clearMessages();
    expect(store.conversations[0].messages).toHaveLength(1);
    expect(store.conversations[0].messages[0].id).toBe('welcome');
  });

  it('returns message preview', async () => {
    const store = useChatStore();
    await store.createConversation('Chat');
    store.conversations[0].messages.push({
      id: 'msg1',
      role: 'user',
      text: 'This is a long message that should be truncated',
      timestamp: new Date(),
    });

    const preview = store.getLastMessagePreview(store.conversations[0]);
    expect(preview).toContain('...');
    expect(preview.length).toBeLessThanOrEqual(25);
  });

  it('returns click hint for empty conversation', async () => {
    const store = useChatStore();
    await store.createConversation('Chat');
    // Only welcome message
    const preview = store.getLastMessagePreview(store.conversations[0]);
    expect(preview).toBe('点击开始新对话');
  });

  it('sorted conversations by updatedAt desc', async () => {
    const store = useChatStore();
    await store.createConversation('First');
    await store.createConversation('Second');

    const sorted = store.sortedConversations;
    expect(sorted[0].title).toBe('Second');
    expect(sorted[1].title).toBe('First');
  });

  it('deletes a specific message', async () => {
    const store = useChatStore();
    await store.createConversation('Chat');
    store.conversations[0].messages.push(
      { id: 'm1', role: 'user', text: 'a', timestamp: new Date() },
      { id: 'm2', role: 'model', text: 'b', timestamp: new Date() }
    );

    store.deleteMessage('m1');
    expect(store.conversations[0].messages.find((m) => m.id === 'm1')).toBeUndefined();
    expect(store.conversations[0].messages.find((m) => m.id === 'm2')).toBeDefined();
  });

  it('does not delete welcome message', async () => {
    const store = useChatStore();
    await store.createConversation('Chat');

    store.deleteMessage('welcome');
    expect(store.conversations[0].messages[0].id).toBe('welcome');
  });

  // —— messagesMap 索引测试（直接测 conversation store） ——
  describe('messagesMap index', async () => {
    let convStore;

    beforeEach(async () => {
      setActivePinia(createPinia());
      localStorage.clear();
      const { useConversationStore } = await import('../stores/conversation.store.js');
      convStore = useConversationStore();
      await convStore.loadConversations();
    });

    it('getMessage finds existing message in O(1)', () => {
      const conv = convStore.conversations[0];
      const targetMsg = conv.messages.find((m) => m.id !== 'welcome') || conv.messages[0];

      const found = convStore.getMessage(targetMsg.id);
      expect(found).not.toBeNull();
      expect(found.message).toBe(targetMsg); // 严格引用相等，证明是同一对象
      expect(found.conversationId).toBe(conv.id);
    });

    it('getMessage returns null for unknown id', () => {
      expect(convStore.getMessage('nonexistent-id')).toBeNull();
    });

    it('index syncs after deleteMessage', async () => {
      const conv = convStore.conversations[0];
      const testMsgId = 'index-test-msg';
      conv.messages.push({ id: testMsgId, role: 'user', content: 'test', timestamp: new Date() });
      convStore.registerMessage(conv.id, conv.messages[conv.messages.length - 1]);

      // 确认索引命中
      expect(convStore.getMessage(testMsgId)).not.toBeNull();

      // 通过 store 的 deleteMessage 删除（需从 chat.store 调用路径，这里直接测索引同步）
      convStore.unregisterMessage(testMsgId);
      expect(convStore.getMessage(testMsgId)).toBeNull();
    });

    it('index syncs when message object is replaced (spread)', () => {
      const conv = convStore.conversations[0];
      const oldMsg = conv.messages[conv.messages.length - 1];
      const oldId = oldMsg.id;

      // 模拟 updater 用 spread 替换对象
      const newMsg = { ...oldMsg, content: 'updated content' };
      conv.messages[conv.messages.length - 1] = newMsg;
      convStore.registerMessage(conv.id, newMsg);

      const found = convStore.getMessage(oldId);
      expect(found).not.toBeNull();
      expect(found.message).toBe(newMsg); // 引用更新为新对象
      expect(found.message.content).toBe('updated content');
    });

    it('rebuildMessagesMap rebuilds from conversations', () => {
      // 直接往数组加消息但不注册（模拟数据不一致）
      const conv = convStore.conversations[0];
      conv.messages.push({ id: 'ghost-msg', role: 'user', content: 'ghost', timestamp: new Date() });
      expect(convStore.getMessage('ghost-msg')).toBeNull(); // 尚未注册

      convStore.rebuildMessagesMap();
      expect(convStore.getMessage('ghost-msg')).not.toBeNull(); // 重建后命中
    });
  });

  it('abortCurrentRequest is a function', () => {
    const store = useChatStore();
    expect(typeof store.abortCurrentRequest).toBe('function');
  });
});
