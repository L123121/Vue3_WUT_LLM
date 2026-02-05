import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { ChatMessage } from '../types/index.ts';
import { sendMessageStream } from '../api/chat.ts';

const STORAGE_KEY = 'chat_messages';

export const useChatStore = defineStore('chat', () => {
  const welcomeMsg: ChatMessage = {
    id: 'welcome',
    role: 'model',
    text: '你好！我是武理小精灵 AI 助手 (Powered by Qwen)。有什么我可以帮你的吗？',
    timestamp: new Date(),
  };

  // 从 localStorage 恢复消息
  const loadMessages = (): ChatMessage[] => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // 恢复 Date 对象
        return parsed.map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        }));
      }
    } catch (e) {
      console.error('Failed to load messages from localStorage:', e);
    }
    return [welcomeMsg];
  };

  const messages = ref<ChatMessage[]>(loadMessages());
  const isLoading = ref(false);
  const currentStreamingId = ref<string | null>(null);

  // 持久化到 localStorage
  const saveMessages = () => {
    try {
      // 只保存最近100条消息，避免 localStorage 溢出
      const toSave = messages.value.slice(-100);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {
      console.error('Failed to save messages to localStorage:', e);
    }
  };

  // 监听消息变化，自动保存
  watch(messages, saveMessages, { deep: true });

  /**
   * 发送消息（流式响应）
   */
  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading.value) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: text,
      timestamp: new Date(),
    };

    messages.value.push(userMsg);
    isLoading.value = true;

    // 构建历史上下文
    const rawHistory = messages.value
      .filter(m => m.id !== 'welcome' && !m.isError && m.id !== userMsg.id && m.text.trim())
      .slice(-20) // 只取最近20条作为上下文
      .map(m => ({
        role: m.role === 'model' ? 'assistant' : m.role, // 转换 model -> assistant
        content: m.text
      }));
    
    // 净化历史记录：确保角色交替（User -> Assistant -> User ...）
    const history: {role: string, content: string}[] = [];
    let lastRole = '';
    
    for (const msg of rawHistory) {
      if (msg.role === lastRole) {
        // 如果出现连续相同角色，移除上一条（保留最新的上下文）
        if (history.length > 0) history.pop();
      }
      history.push(msg);
      lastRole = msg.role;
    }

    // 再次校验：历史记录最后一条如果是 user，会导致与当前 user 消息重复，需要移除
    if (history.length > 0 && history[history.length - 1].role === 'user') {
      history.pop();
    }

    // 创建 AI 回复占位
    const aiMsgId = (Date.now() + 1).toString();
    const aiMsg: ChatMessage = {
      id: aiMsgId,
      role: 'model',
      text: '',
      timestamp: new Date(),
    };
    messages.value.push(aiMsg);
    currentStreamingId.value = aiMsgId;

    return new Promise<void>((resolve) => {
      sendMessageStream(text, history, {
        onChunk: (content: string) => {
          console.log('[ChatStore] Received chunk:', content);
          // 找到当前流式消息并追加内容
          const msgIndex = messages.value.findIndex(m => m.id === aiMsgId);
          if (msgIndex > -1) {
            messages.value[msgIndex].text += content;
            console.log('[ChatStore] Updated message:', messages.value[msgIndex].text);
          }
        },
        onDone: () => {
          console.log('[ChatStore] Stream done');
          currentStreamingId.value = null;
          isLoading.value = false;
          resolve();
        },
        onError: (error: Error) => {
          console.error('Stream error:', error);
          const msg = messages.value.find(m => m.id === aiMsgId);
          if (msg) {
            if (!msg.text) {
              msg.text = '抱歉，连接服务器失败，请检查后端服务是否启动。';
              msg.isError = true;
            }
          }
          currentStreamingId.value = null;
          isLoading.value = false;
          resolve();
        }
      });
    });
  };

  /**
   * 清空消息
   */
  const clearMessages = () => {
    messages.value = [welcomeMsg];
    localStorage.removeItem(STORAGE_KEY);
  };

  /**
   * 获取会话历史（用于上下文恢复）
   */
  const getConversationHistory = () => {
    return messages.value
      .filter(m => m.id !== 'welcome' && !m.isError)
      .map(m => ({
        role: m.role,
        content: m.text,
        timestamp: m.timestamp
      }));
  };

  /**
   * 删除单条消息
   */
  const deleteMessage = (id: string) => {
    const index = messages.value.findIndex(m => m.id === id);
    if (index > -1 && id !== 'welcome') {
      messages.value.splice(index, 1);
    }
  };

  return { 
    messages, 
    isLoading, 
    currentStreamingId,
    sendMessage, 
    clearMessages,
    getConversationHistory,
    deleteMessage
  };
});