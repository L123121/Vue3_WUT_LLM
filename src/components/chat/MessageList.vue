<script setup>
import { ref, watch, nextTick, onMounted } from 'vue';
import { Bot, User, Sparkles, Loader2, Copy } from 'lucide-vue-next';
import { useLanguageStore } from '../../stores/language.store.js';
import MarkdownRenderer from './MarkdownRenderer.vue';

const props = defineProps({
  messages: { type: Array, default: () => [] },
  isLoading: Boolean,
  currentStreamingId: String,
});

const emit = defineEmits(['copy']);
const languageStore = useLanguageStore();
const messagesEndRef = ref(null);

const formatTime = (timestamp) => languageStore.formatTime(timestamp);
const scrollToBottom = async () => {
  await nextTick();
  messagesEndRef.value?.scrollIntoView({ behavior: 'smooth' });
};
const copyMessage = (text) => navigator.clipboard.writeText(text).then(() => emit('copy', text));

watch(() => props.messages.length, scrollToBottom);
watch(() => {
  if (props.currentStreamingId) {
    const msg = props.messages.find((item) => item.id === props.currentStreamingId);
    return msg?.text.length || 0;
  }
  return 0;
}, scrollToBottom);
onMounted(scrollToBottom);
defineExpose({ scrollToBottom });
</script>

<template>
  <div class="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth">
    <div v-if="messages.length === 0" class="flex flex-col items-center justify-center h-full text-slate-400 dark:text-gray-500 space-y-4 opacity-50">
      <Bot :size="48" class="stroke-1" />
      <p class="text-sm">{{ languageStore.t('chat.empty') }}</p>
    </div>

    <div v-for="msg in messages" :key="msg.id" :class="['flex', msg.role === 'user' ? 'justify-end' : 'justify-start', 'group']">
      <div :class="['flex max-w-[85%] md:max-w-[75%]', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row', 'items-end gap-2']">
        <div :class="['w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm overflow-hidden', msg.role === 'user' ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-gradient-to-tr from-blue-500 to-indigo-400 text-white']">
          <User v-if="msg.role === 'user'" :size="14" class="text-blue-600 dark:text-blue-400" />
          <Sparkles v-else :size="14" />
        </div>

        <div :class="['px-5 py-3.5 shadow-sm text-sm leading-relaxed relative max-w-full overflow-hidden', msg.role === 'user' ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm' : msg.isError ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-800/50 rounded-2xl rounded-tl-sm' : 'bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 border border-slate-100 dark:border-gray-700 rounded-2xl rounded-tl-sm', (msg.role === 'model' && !msg.isError) ? 'pr-16' : '']">
          <MarkdownRenderer v-if="msg.role === 'model' && !msg.isError" :content="msg.text" />
          <button v-if="msg.role === 'model' && !msg.isError && msg.text" class="copy-btn absolute top-2 right-3 flex items-center gap-1.5 hover:text-blue-500 transition-all duration-200 cursor-pointer px-2 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-gray-700 text-xs text-slate-400" @click="copyMessage(msg.text)" :title="languageStore.t('chat.copyReply')"><Copy :size="12" /><span>{{ languageStore.t('chat.copy') }}</span></button>
          <div v-if="msg.role === 'user'" class="whitespace-pre-wrap leading-relaxed">{{ msg.text }}</div>
          <div v-if="msg.isError" class="whitespace-pre-wrap leading-relaxed">{{ msg.text }}</div>
          <div :class="['text-[9px] mt-1.5 opacity-60 text-right', msg.role === 'user' ? 'text-blue-100' : 'text-slate-400 dark:text-gray-500']">{{ formatTime(msg.timestamp) }}</div>
        </div>
      </div>
    </div>

    <div v-if="isLoading && !currentStreamingId" class="flex justify-start">
      <div class="flex items-center ml-10 bg-white dark:bg-gray-800 px-4 py-3 rounded-2xl rounded-tl-none border border-slate-100 dark:border-gray-700 shadow-sm">
        <Loader2 class="w-4 h-4 animate-spin text-blue-500 mr-2" />
        <span class="text-xs text-slate-500 dark:text-gray-400">{{ languageStore.t('chat.thinking') }}</span>
      </div>
    </div>

    <div ref="messagesEndRef"></div>
  </div>
</template>
