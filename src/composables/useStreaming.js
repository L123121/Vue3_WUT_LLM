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

/**
 * 更新消息对象的辅助函数
 * 用新数组替换 conv.messages（属性赋值），触发 Vue 响应式链
 *
 * 关键：按 conversationId 在调用时重新解析会话下标，不缓存 convIndex。
 * 流式过程中会话列表可能被 loadConversations / unshift 重排，缓存的下标
 * 会指向错误的会话，导致消息写进别的会话。
 *
 * 持久化交给 convStore.scheduleSaveCache()（300ms 防抖的增量保存），
 * 不再在此处对整个会话列表做 JSON.parse(JSON.stringify(...)) 全量序列化——
 * 流式每个 chunk 都触发一次会阻塞主线程。
 */
function updateMessage(convStore, conversationId, msgId, updater) {
  const convIndex = convStore.conversations.findIndex((c) => c.id === conversationId);
  if (convIndex === -1) return null;
  const conv = convStore.conversations[convIndex];
  if (!conv) return null;
  const msgs = conv.messages;
  if (!msgs) return null;
  const msgIdx = msgs.findIndex((m) => m.id === msgId);
  if (msgIdx === -1) return null;
  const newMessages = msgs.map((m, i) => (i === msgIdx ? updater(m) : m));
  // 替换 messages 属性（而非整个 conv 对象），触发 conv.messages 的响应式追踪
  conv.messages = newMessages;
  // 防抖增量持久化（非每帧全量同步写）
  convStore.scheduleSaveCache();
  return msgIdx;
}

export function useStreaming() {
  const isLoading = ref(false);
  const currentStreamingId = ref(null);
  const isConnected = ref(true);
  const isReconnecting = ref(false);
  const reconnectAttempt = ref(0);

  let currentAbortController = null;
  // 当前正在流式的会话 id（响应式，供 store 层在切换会话时判断是否需中止）
  const activeStreamingConversationId = ref(null);
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
    activeStreamingConversationId.value = null;
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
    activeStreamingConversationId.value = conversationId;
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
          // 切换会话自中止检测：用户已切到别的会话时，停止向旧会话写消息并中止请求，
          // 否则 currentStreamingId 仍指向旧会话消息，新会话 UI 状态会错乱
          if (convStore.currentConversationId !== conversationId) {
            console.log('[Stream] 检测到会话已切换，中止旧流式');
            abortCurrentRequest();
            return;
          }
          pendingContent += content;
          if (!rafId) {
            rafId = requestAnimationFrame(() => {
              updateMessage(convStore, conversationId, aiMsgId, (m) => {
                const newText = getMessageText(m) + pendingContent;
                return { ...m, text: newText, content: newText };
              });
              pendingContent = '';
              rafId = null;
            });
          }
          onStreamEvent?.('chunk', content);
        },
        onSources: (sources) => {
          updateMessage(convStore, conversationId, aiMsgId, (m) => ({ ...m, sources }));
        },
        onThinking: (content) => {
          updateMessage(convStore, conversationId, aiMsgId, (m) => {
            const existing = m.thinkingSteps || [];
            if (existing.length && existing[existing.length - 1].content === content) return m;
            const steps = [...existing, { content }];
            const timelineEvent = { type: 'thinking', content };
            const timeline = [...(m._timeline || []), timelineEvent];
            return { ...m, thinkingSteps: steps, _timeline: timeline };
          });
        },
        onToolCall: (toolCall) => {
          updateMessage(convStore, conversationId, aiMsgId, (m) => {
            const existing = m.toolCalls || [];
            if (existing.some((tc) => tc.id === toolCall.id)) return m;
            const calls = [...existing, { ...toolCall, status: 'running', result: '' }];
            const timelineEvent = { type: 'tool', id: toolCall.id, name: toolCall.name };
            const timeline = [...(m._timeline || []), timelineEvent];
            return { ...m, toolCalls: calls, _timeline: timeline };
          });
        },
        onToolResult: (toolResult) => {
          updateMessage(convStore, conversationId, aiMsgId, (m) => {
            const calls = (m.toolCalls || []).map((tc) =>
              tc.id === toolResult.id ? { ...tc, result: toolResult.content, status: toolResult.status || 'done' } : tc
            );
            return { ...m, toolCalls: calls };
          });
        },
        onRetry: () => {
          isReconnecting.value = true;
          reconnectAttempt.value = reconnectAttempt.value + 1;
        },
        onDone: () => {
          // 必须在 cancelPendingRaf 之前捕获剩余内容（它会清空 pendingContent）
          const remainingContent = pendingContent;
          cancelPendingRaf();
          if (remainingContent) {
            updateMessage(convStore, conversationId, aiMsgId, (m) => {
              const newText = getMessageText(m) + remainingContent;
              return { ...m, text: newText, content: newText };
            });
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
          activeStreamingConversationId.value = null;
          currentAbortController = null;
          convStore.scheduleSaveCache(true);
          // 额外保存：把当前会话消息单独存一份（固定 key，不受 convId 变化影响）
          try {
            // 重新按 id 解析会话，避免使用流开始时缓存的 convIndex（列表可能已重排）
            const doneConv = convStore.conversations.find((c) => c.id === conversationId);
            const msgBackup = doneConv?.messages;
            if (msgBackup && msgBackup.length > 0) {
              localStorage.setItem('chat_msgs_last', JSON.stringify({
                messages: msgBackup,
                conversationId: conversationId,
                title: doneConv?.title || '',
              }));
            }
          } catch (e) {}
          onStreamEvent?.('done');
          markResolved();
          resolve();
        },
        onError: (error) => {
          console.log('[Stream] onError callback fired:', error.message);
          cancelPendingRaf();

          // 空内容的 AI 消息标记为错误
          updateMessage(convStore, conversationId, aiMsgId, (m) => {
            if (getMessageText(m)) return m;
            return { ...m, content: '抱歉，连接服务器失败，请检查后端服务是否启动。', isError: true };
          });
          // 用户的失败消息标记可重试
          updateMessage(convStore, conversationId, userMsg.id, (m) => ({ ...m, canRetry: true }));

          currentStreamingId.value = null;
          isLoading.value = false;
          isReconnecting.value = false;
          activeStreamingConversationId.value = null;
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
          activeStreamingConversationId.value = null;
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
      activeStreamingConversationId.value = null;
      currentStreamingId.value = null;
      isLoading.value = false;
    }
  };

  return {
    isLoading,
    currentStreamingId,
    activeStreamingConversationId,
    isConnected,
    isReconnecting,
    reconnectAttempt,
    sendMessage,
    retryMessage,
    abortCurrentRequest,
    cleanup,
  };
}
