/**
 * useStreaming — 流式消息处理 composable
 *
 * 管理 SSE 流式请求的建立、chunk 处理、重连、中断
 */

import { ref, onUnmounted } from 'vue';
import { sendMessageStream, connectionManager } from '../api/chat.js';
import { useConversationStore } from '../stores/conversation.store.js';
import { useSkillStore } from '../stores/skill.store.js';
import {
  createMessageId,
  getMessageText,
  normalizeMessages,
} from '../utils/chatHelpers.js';

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30000;
const STREAM_STALL_TIMEOUT = 60000;

export function useStreaming() {
  const isLoading = ref(false);
  const currentStreamingId = ref(null);
  const isConnected = ref(true);
  const isReconnecting = ref(false);
  const reconnectAttempt = ref(0);

  let currentAbortController = null;
  let activeStreamingConversationId = null;
  let unsubscribeConnection = null;
  let rafId = null;
  let pendingContent = '';

  unsubscribeConnection = connectionManager.subscribe((event) => {
    if (event === 'connected') {
      isConnected.value = true;
      isReconnecting.value = false;
      reconnectAttempt.value = 0;
    } else if (event === 'disconnected') {
      isConnected.value = false;
    }
  });

  const cancelPendingRaf = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
      pendingContent = '';
    }
  };

  const cleanup = () => {
    cancelPendingRaf();
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    activeStreamingConversationId = null;
    currentStreamingId.value = null;
    isLoading.value = false;
    isReconnecting.value = false;
    reconnectAttempt.value = 0;
    if (unsubscribeConnection) {
      unsubscribeConnection();
      unsubscribeConnection = null;
    }
  };

  onUnmounted(() => {
    cleanup();
  });

  const buildHistory = (msgs, currentUserMessageId) => {
    const rawHistory = msgs
      .filter((m) => m.id !== 'welcome' && !m.isError && m.id !== currentUserMessageId && getMessageText(m))
      .slice(-20)
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : m.role,
        content: getMessageText(m),
      }));

    const history = [];
    let lastRole = '';
    for (const m of rawHistory) {
      if (m.role === lastRole && history.length > 0) history.pop();
      history.push(m);
      lastRole = m.role;
    }
    if (history.length > 0 && history[history.length - 1].role === 'user') history.pop();
    return history;
  };

  const getExponentialDelay = (attempt) => {
    const delayMs = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt), MAX_RETRY_DELAY);
    return delayMs + Math.random() * 1000;
  };

  const sendMessage = async (text, retryMsgId = null, fileData = null, onStreamEvent) => {
    const trimmedText = text.trim();
    const convStore = useConversationStore();
    let conv = convStore.currentConversation;

    if (!conv) {
      conv = { id: createMessageId(), title: '本地会话', messages: [createWelcomeMessage()], createdAt: new Date(), updatedAt: new Date() };
      convStore.conversations.push(conv);
      convStore.currentConversationId = conv.id;
    }

    if (!trimmedText && !fileData) return;
    if (isLoading.value) return;

    const conversationId = conv.id;
    let convIndex = convStore.conversations.findIndex((c) => c.id === conversationId);
    if (convIndex === -1) {
      convStore.conversations.push({ ...conv, messages: normalizeMessages(conv.messages) });
      convIndex = convStore.conversations.findIndex((c) => c.id === conversationId);
      if (convIndex === -1) return;
    }

    let userMsg;
    if (retryMsgId) {
      const idx = convStore.conversations[convIndex].messages?.findIndex((m) => m.id === retryMsgId);
      if (idx > -1) {
        userMsg = convStore.conversations[convIndex].messages[idx];
        convStore.conversations[convIndex].messages.splice(idx, 2);
      }
    }

    if (!userMsg) {
      userMsg = { id: createMessageId(), role: 'user', content: trimmedText, timestamp: new Date(), files: fileData ? [fileData] : [] };
      if (!convStore.conversations[convIndex].messages) convStore.conversations[convIndex].messages = [];
      convStore.conversations[convIndex].messages.push(userMsg);
    } else {
      convStore.conversations[convIndex].messages.push(userMsg);
    }
    convStore.conversations[convIndex].updatedAt = new Date();
    convStore.scheduleSaveCache(true);

    isLoading.value = true;
    activeStreamingConversationId = conversationId;
    currentAbortController = new AbortController();

    const history = buildHistory(convStore.conversations[convIndex].messages || [], userMsg.id);
    const skillPrompt = useSkillStore().buildSystemPrompt();

    const aiMsgId = createMessageId();
    const aiMsg = { id: aiMsgId, role: 'model', content: '', timestamp: new Date(), sources: [], toolCalls: [], thinkingSteps: [] };
    convStore.conversations[convIndex].messages.push(aiMsg);
    currentStreamingId.value = aiMsgId;

    let messageToSend = trimmedText;
    if (fileData?.textContent) {
      const fileBlock = `[文件: ${fileData.name}]\n\`\`\`\n${fileData.textContent}\n\`\`\``;
      messageToSend = trimmedText
        ? `${fileBlock}\n\n用户问题: ${trimmedText}`
        : `${fileBlock}\n\n请根据以上文件内容回答。`;
    }

    return new Promise((resolve, reject) => {
      let resolved = false;
      const safetyTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('响应超时，请检查网络连接后重试'));
        }
      }, STREAM_STALL_TIMEOUT + 5000);
      const markResolved = () => { resolved = true; clearTimeout(safetyTimeout); };

      const callbacks = {
        onChunk: (content) => {
          pendingContent += content;
          if (!rafId) {
            rafId = requestAnimationFrame(() => {
              const msgs = convStore.conversations[convIndex]?.messages;
              if (msgs) {
                const msgIdx = msgs.findIndex((m) => m.id === aiMsgId);
                if (msgIdx !== -1) {
                  msgs[msgIdx] = { ...msgs[msgIdx], content: getMessageText(msgs[msgIdx]) + pendingContent };
                }
              }
              pendingContent = '';
              rafId = null;
            });
          }
          onStreamEvent?.('chunk', content);
        },
        onSources: (sources) => {
          const msgs = convStore.conversations[convIndex]?.messages;
          if (msgs) {
            const msgIdx = msgs.findIndex((m) => m.id === aiMsgId);
            if (msgIdx !== -1) {
              msgs[msgIdx] = { ...msgs[msgIdx], sources };
            }
          }
        },
        onThinking: (content) => {
          const msgs = convStore.conversations[convIndex]?.messages;
          if (msgs) {
            const msgIdx = msgs.findIndex((m) => m.id === aiMsgId);
            if (msgIdx !== -1) {
              const existing = msgs[msgIdx].thinkingSteps || [];
              if (!existing.length || existing[existing.length - 1].content !== content) {
                const steps = [...existing, { content }];
                const timelineEvent = { type: 'thinking', content };
                const timeline = [...(msgs[msgIdx]._timeline || []), timelineEvent];
                msgs[msgIdx] = { ...msgs[msgIdx], thinkingSteps: steps, _timeline: timeline };
              }
            }
          }
        },
        onToolCall: (toolCall) => {
          const msgs = convStore.conversations[convIndex]?.messages;
          if (msgs) {
            const msgIdx = msgs.findIndex((m) => m.id === aiMsgId);
            if (msgIdx !== -1) {
              const existing = msgs[msgIdx].toolCalls || [];
              if (!existing.some((tc) => tc.id === toolCall.id)) {
                const calls = [...existing, { ...toolCall, status: 'running', result: '' }];
                const timelineEvent = { type: 'tool', id: toolCall.id, name: toolCall.name };
                const timeline = [...(msgs[msgIdx]._timeline || []), timelineEvent];
                msgs[msgIdx] = { ...msgs[msgIdx], toolCalls: calls, _timeline: timeline };
              }
            }
          }
        },
        onToolResult: (toolResult) => {
          const msgs = convStore.conversations[convIndex]?.messages;
          if (msgs) {
            const msgIdx = msgs.findIndex((m) => m.id === aiMsgId);
            if (msgIdx !== -1) {
              const calls = (msgs[msgIdx].toolCalls || []).map((tc) =>
                tc.id === toolResult.id ? { ...tc, result: toolResult.content, status: toolResult.status || 'done' } : tc
              );
              msgs[msgIdx] = { ...msgs[msgIdx], toolCalls: calls };
            }
          }
        },
        onRetry: () => {
          isReconnecting.value = true;
          reconnectAttempt.value = reconnectAttempt.value + 1;
        },
        onDone: () => {
          cancelPendingRaf();
          if (pendingContent) {
            const msgs = convStore.conversations[convIndex]?.messages;
            if (msgs) {
              const msgIdx = msgs.findIndex((m) => m.id === aiMsgId);
              if (msgIdx !== -1) {
                const updated = { ...msgs[msgIdx], content: getMessageText(msgs[msgIdx]) + pendingContent, text: getMessageText(msgs[msgIdx]) + pendingContent };
                msgs[msgIdx] = updated;
              }
            }
          }
          if (conv && (conv.title.startsWith('新会话') || conv.title === '默认会话')) {
            const userText = trimmedText;
            if (userText) {
              const cleanText = userText
                .replace(/[【】《》「」『』\[\]""'']/g, '')
                .replace(/[#*_~`\\]/g, '')
                .trim();
              const greeting = /^(你好|您好|hi|hello|嗨|hey|在吗|在不在|早上好|晚上好|下午好)[!！.。]?$/i;
              conv.title = greeting.test(cleanText) ? '新对话' : (cleanText.slice(0, 10) || '新对话');
              convStore.renameConversation(conversationId, conv.title);
              convStore.scheduleSaveCache(true);
            }
          }

          currentStreamingId.value = null;
          isLoading.value = false;
          isReconnecting.value = false;
          reconnectAttempt.value = 0;
          activeStreamingConversationId = null;
          currentAbortController = null;
          convStore.scheduleSaveCache(true);
          onStreamEvent?.('done');
          markResolved();
          resolve();
        },
        onError: (error) => {
          console.log('[Stream] onError callback fired:', error.message);
          cancelPendingRaf();

          const msgs = convStore.conversations[convIndex]?.messages;
          if (msgs) {
            const msgIdx = msgs.findIndex((m) => m.id === aiMsgId);
            if (msgIdx !== -1 && !getMessageText(msgs[msgIdx])) {
              msgs[msgIdx] = { ...msgs[msgIdx], content: '抱歉，连接服务器失败，请检查后端服务是否启动。', isError: true };
            }
            const userIdx = msgs.findIndex((m) => m.id === userMsg.id);
            if (userIdx !== -1) {
              msgs[userIdx] = { ...msgs[userIdx], canRetry: true };
            }
          }

          currentStreamingId.value = null;
          isLoading.value = false;
          isReconnecting.value = false;
          activeStreamingConversationId = null;
          currentAbortController = null;
          convStore.scheduleSaveCache(true);
          onStreamEvent?.('error');
          markResolved();
          resolve();
        },
        onAbort: () => {
          cancelPendingRaf();
          isLoading.value = false;
          isReconnecting.value = false;
          activeStreamingConversationId = null;
          currentAbortController = null;
          markResolved();
          resolve();
        },
      };

      try {
        sendMessageStream(messageToSend, history, callbacks, {
          signal: currentAbortController.signal,
          conversationId,
          files: fileData ? [fileData] : [],
        });
      } catch (err) {
        markResolved();
        reject(err);
      }
    });
  };

  const retryMessage = async (msgId) => {
    const convStore = useConversationStore();
    const conv = convStore.currentConversation;
    if (!conv) return;
    const msg = conv.messages?.find((m) => m.id === msgId);
    if (!msg || msg.role !== 'user' || !msg.canRetry) return;
    msg.canRetry = false;
    await sendMessage(getMessageText(msg), false, msgId);
  };

  const abortCurrentRequest = () => {
    cancelPendingRaf();
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
      activeStreamingConversationId = null;
      currentStreamingId.value = null;
      isLoading.value = false;
    }
  };

  return {
    isLoading,
    currentStreamingId,
    isConnected,
    isReconnecting,
    reconnectAttempt,
    sendMessage,
    retryMessage,
    abortCurrentRequest,
    cleanup,
  };
}
