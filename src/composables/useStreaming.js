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
  createWelcomeMessage,
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
  const updatedMsg = updater(msgs[msgIdx]);
  const newMessages = msgs.map((m, i) => (i === msgIdx ? updatedMsg : m));
  // 替换 messages 属性（而非整个 conv 对象），触发 conv.messages 的响应式追踪
  conv.messages = newMessages;
  // 同步消息索引：updater 可能返回新对象（spread），需更新 map 引用
  convStore.registerMessage(conversationId, updatedMsg);
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
  let visibilityHandler = null;

  // 后台 Tab RAF 兜底：visibilitychange → hidden 时，pendingContent 立即落盘
  // 浏览器在后台 Tab 会暂停 requestAnimationFrame，导致流式内容一直堆积在
  // pendingContent 中，直到切回前台或流结束才一次性刷新，用户体验上是"长时间无反应"
  // 加这个监听后，只要切到后台就立即刷到消息，保证下次切回来时能看到最新内容
  const setupVisibilityHandler = () => {
    visibilityHandler = () => {
      if (document.visibilityState === 'hidden' && pendingContent) {
        // 取消待执行的 RAF（避免重复写）
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        // 把累积的 pendingContent 立即写到消息
        const convStore = useConversationStore();
        if (activeStreamingConversationId.value && currentStreamingId.value) {
          updateMessage(convStore, activeStreamingConversationId.value, currentStreamingId.value, (m) => {
            const newText = getMessageText(m) + pendingContent;
            return { ...m, text: newText, content: newText };
          });
        }
        pendingContent = '';
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  };
  setupVisibilityHandler();

  unsubscribeConnection = connectionManager.subscribe((event) => {
    if (event === 'connected') {
      isConnected.value = true;
      isReconnecting.value = false;
      reconnectAttempt.value = 0;
    } else if (event === 'disconnected') {
      isConnected.value = false;
    }
  });

  const cancelPendingRaf = (flushToMessage = false) => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (flushToMessage && pendingContent) {
      const convStore = useConversationStore();
      if (activeStreamingConversationId.value && currentStreamingId.value) {
        updateMessage(convStore, activeStreamingConversationId.value, currentStreamingId.value, (m) => {
          const newText = getMessageText(m) + pendingContent;
          return { ...m, text: newText, content: newText };
        });
      }
    }
    pendingContent = '';
  };

  const cleanup = () => {
    cancelPendingRaf();
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = null;
    }
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
        // 重试时移除用户消息 + 对应 AI 回复（2 条），同步清理索引
        const removedUser = convStore.conversations[convIndex].messages[idx];
        const removedAi = convStore.conversations[convIndex].messages[idx + 1];
        convStore.conversations[convIndex].messages.splice(idx, 2);
        convStore.unregisterMessage(removedUser?.id);
        convStore.unregisterMessage(removedAi?.id);
      }
    }

    if (!userMsg) {
      userMsg = { id: createMessageId(), role: 'user', content: trimmedText, timestamp: new Date(), files: fileData ? [fileData] : [] };
      if (!convStore.conversations[convIndex].messages) convStore.conversations[convIndex].messages = [];
      convStore.conversations[convIndex].messages.push(userMsg);
      convStore.registerMessage(conversationId, userMsg);
    } else {
      convStore.conversations[convIndex].messages.push(userMsg);
      convStore.registerMessage(conversationId, userMsg);
    }
    convStore.conversations[convIndex].updatedAt = new Date();
    convStore.scheduleSaveCache(true);

    isLoading.value = true;
    activeStreamingConversationId.value = conversationId;
    currentAbortController = new AbortController();

    // TTFT 埋点变量
    const streamStartTime = performance.now();
    let firstChunkReceived = false;
    let firstFramePainted = false;

    const history = buildHistory(convStore.conversations[convIndex].messages || [], userMsg.id);
    const skillPrompt = useSkillStore().buildSystemPrompt();

    const aiMsgId = createMessageId();
    const aiMsg = { id: aiMsgId, role: 'model', content: '', timestamp: new Date(), sources: [] };
    convStore.conversations[convIndex].messages.push(aiMsg);
    convStore.registerMessage(conversationId, aiMsg);
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
          // 首字上屏埋点：第一个 chunk 到达时记录时间
          if (!firstChunkReceived) {
            firstChunkReceived = true;
            const firstChunkMs = Math.round(performance.now() - streamStartTime);
            console.log(`[TTFT] 首字上屏(RAF前): ${firstChunkMs}ms`);
          }
          pendingContent += content;
          if (!rafId) {
            rafId = requestAnimationFrame(() => {
              // 首字渲染埋点：RAF 回调执行 = 真正写 DOM 的时刻
              if (!firstFramePainted) {
                firstFramePainted = true;
                const firstFrameMs = Math.round(performance.now() - streamStartTime);
                console.log(`[TTFT] 首字渲染(DOM写入): ${firstFrameMs}ms`);
                try {
                  const key = 'ttft_frame_measurements';
                  const arr = JSON.parse(localStorage.getItem(key) || '[]');
                  arr.push({ ts: Date.now(), firstFrame: firstFrameMs, msg: text.substring(0, 30) });
                  while (arr.length > 100) arr.shift();
                  localStorage.setItem(key, JSON.stringify(arr));
                } catch (_) {}
              }
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
          updateMessage(convStore, conversationId, aiMsgId, (m) => ({ ...m, sources, answerMode: 'rag', usedRag: true }));
        },
        onTrace: (payload) => {
          const trace = payload?.trace || null;
          const rag = payload?.rag || trace?.outcome || {};
          const usedRag = rag.usedRag === true;
          updateMessage(convStore, conversationId, aiMsgId, (m) => ({
            ...m,
            traceId: payload?.traceId || trace?.traceId || m.traceId,
            ragTrace: trace || m.ragTrace,
            ...(usedRag ? { answerMode: 'rag', usedRag: true } : {}),
          }));
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
    await sendMessage(getMessageText(msg), msgId);
  };

  const abortCurrentRequest = () => {
    cancelPendingRaf(true); // 刷新 RAF 缓冲区到消息后中止，避免内容丢失
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
