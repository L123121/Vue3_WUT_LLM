import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useChatStore } from '../stores/chat.store.js';

// Mock the API modules
vi.mock('../api/chat.js', () => ({
  sendMessageStream: vi.fn(),
  connectionManager: {
    subscribe: vi.fn(() => () => {}),
    isConnected: true,
  },
  generateTitle: vi.fn().mockResolvedValue('Mock Title'),
}));

vi.mock('../api/conversations.js', () => ({
  fetchConversations: vi.fn().mockResolvedValue([]),
  createConversation: vi.fn(),
  fetchConversation: vi.fn(),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
  clearConversationMessages: vi.fn(),
}));

describe('chatStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
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
