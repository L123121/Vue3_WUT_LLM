import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import AIChat from '../views/AIChat.vue';

// 视图层冒烟测试：views 层此前零测试，1ff55b9 删除 i18n 层时模板里
// 残留的 {{ text.model }} 等引用让 /chat 页渲染即抛 TypeError，且连续
// 多次死代码清扫都没发现。本用例锁定「AIChat 必须能完整渲染」这条底线。

vi.mock('../api/rag.js', () => ({
  getDocuments: vi.fn().mockRejectedValue(new Error('offline')),
}));

vi.mock('../api/conversations.js', () => ({
  fetchConversations: vi.fn().mockResolvedValue([]),
  createConversation: vi.fn(),
  fetchConversation: vi.fn().mockResolvedValue(null),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
  saveConversationMessages: vi.fn().mockResolvedValue(true),
  clearConversationMessages: vi.fn().mockResolvedValue(true),
}));

vi.mock('../api/chat.js', () => ({
  sendMessageStream: vi.fn(),
  connectionManager: {
    subscribe: vi.fn(() => () => {}),
    isConnected: true,
  },
}));

vi.mock('../api/audio.js', () => ({
  synthesizeSpeech: vi.fn(),
}));

vi.mock('../api/share.js', () => ({
  createShareSnapshot: vi.fn(),
}));

// 显式声明 props 的 stub:默认 stub 是普通元素,isConnected 会撞上
// Node.isConnected 只读属性导致 Vue 警告
const ChatBoxStub = {
  name: 'ChatBox',
  props: ['isLoading', 'placeholder', 'isConnected', 'isReconnecting', 'reconnectAttempt'],
  template: '<div />',
};

const mountChat = () => shallowMount(AIChat, {
  global: {
    plugins: [createPinia()],
    stubs: { ChatBox: ChatBoxStub },
  },
});

describe('AIChat 渲染底线', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('挂载时不抛出渲染错误(锁定 1ff55b9 模板残留 text 引用的回归)', () => {
    expect(() => mountChat()).not.toThrow();
  });

  it('头部展示内联的助手标识与清空按钮文案', () => {
    const wrapper = mountChat();

    expect(wrapper.html()).toContain('AI 助手');
    expect(wrapper.find('button[title="清空当前会话"]').exists()).toBe(true);
  });

  it('向 ChatBox 传递内联的输入框占位文案', () => {
    const wrapper = mountChat();

    const chatBox = wrapper.findComponent(ChatBoxStub);
    expect(chatBox.props('placeholder')).toBe('输入您的问题...');
  });
});
