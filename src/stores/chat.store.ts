import { defineStore } from 'pinia';
import { ref } from 'vue';
import { ChatMessage } from '../types/index.ts';
import { sendMessageToBackend } from '../api/chat.ts';

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'model',
      text: '你好！我是武理小精灵 AI 助手 (Powered by Qwen)。有什么我可以帮你的吗？',
      timestamp: new Date(),
    }
  ]);
  
  const isLoading = ref(false);

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

    try {
      const history = messages.value
        .filter(m => m.id !== 'welcome' && !m.isError)
        .map(m => ({
          role: m.role,
          content: m.text
        }));

      const responseText = await sendMessageToBackend(text, history);

      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText,
        timestamp: new Date(),
      };
      messages.value.push(aiMsg);
    } catch (error) {
      messages.value.push({
        id: Date.now().toString(),
        role: 'model',
        text: '抱歉，连接服务器失败，请检查后端服务是否启动。',
        timestamp: new Date(),
        isError: true
      });
    } finally {
      isLoading.value = false;
    }
  };

  const clearMessages = () => {
    messages.value = [];
  };

  return { messages, isLoading, sendMessage, clearMessages };
});