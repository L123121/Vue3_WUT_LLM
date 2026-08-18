import { nextTick, ref } from 'vue';

export function useChatScroll(favoritesStore) {
  const messageListRef = ref(null);
  const chatBoxRef = ref(null);

  const focusChatInput = () => chatBoxRef.value?.focus();

  const scrollToBottom = async () => {
    await nextTick();
    messageListRef.value?.scrollToBottom();
  };

  const scrollToFavoritedMessage = async (messageId) => {
    if (!messageId) return;
    await nextTick();
    const scroll = () => document.getElementById(`msg-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (document.getElementById(`msg-${messageId}`)) scroll();
    else setTimeout(scroll, 400);
    favoritesStore.consumeScrollRequest();
  };

  return { messageListRef, chatBoxRef, focusChatInput, scrollToBottom, scrollToFavoritedMessage };
}
