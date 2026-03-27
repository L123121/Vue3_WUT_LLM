<script setup>
import { ref, watch, nextTick } from 'vue';
import { Send, Sparkles } from 'lucide-vue-next';
import { useLanguageStore } from '../../stores/language.store.js';
import VoiceRecorder from './VoiceRecorder.vue';

const props = defineProps({
  isLoading: Boolean,
  placeholder: String,
});

const emit = defineEmits(['send', 'error']);
const languageStore = useLanguageStore();
const input = ref('');
const textareaRef = ref(null);
const debouncedInput = ref('');
let debounceTimer = null;

watch(input, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debouncedInput.value = val;
  }, 150);
});

const handleSend = async () => {
  if (!input.value.trim() || props.isLoading) return;
  const message = input.value.trim();
  input.value = '';
  emit('send', message);
  await nextTick();
  textareaRef.value?.focus();
};

const handleKeydown = (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
};

const handleTranscript = (text) => {
  input.value += text;
};

defineExpose({
  focus: () => textareaRef.value?.focus(),
  clear: () => { input.value = ''; },
});
</script>

<template>
  <div class="p-4 bg-white dark:bg-gray-900 border-t border-slate-100 dark:border-gray-800 z-10">
    <div class="relative flex items-end gap-2 bg-slate-100 dark:bg-gray-800 rounded-2xl p-2 border border-transparent focus-within:border-blue-300 dark:focus-within:border-blue-700 focus-within:bg-white dark:focus-within:bg-gray-800 focus-within:ring-4 focus-within:ring-blue-100 dark:focus-within:ring-blue-900/20 transition-all duration-300">
      <textarea
        ref="textareaRef"
        v-model="input"
        @keydown="handleKeydown"
        :placeholder="placeholder || languageStore.t('chat.inputPlaceholder')"
        :disabled="isLoading"
        rows="1"
        class="w-full bg-transparent text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-gray-500 border-none focus:ring-0 px-3 py-2.5 outline-none resize-none max-h-32 text-sm"
        style="min-height: 44px;"
      ></textarea>

      <VoiceRecorder :disabled="isLoading" @transcript="handleTranscript" @error="(message) => emit('error', message)" />

      <button
        @click="handleSend"
        :disabled="!input.trim() || isLoading"
        :class="[
          'p-2.5 rounded-xl transition-all duration-300 mb-0.5 shrink-0',
          !input.trim() || isLoading ? 'bg-slate-200 text-slate-400 dark:bg-gray-700 dark:text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-500/20 active:scale-95'
        ]"
      >
        <Sparkles v-if="isLoading" :size="18" class="animate-spin" />
        <Send v-else :size="18" />
      </button>
    </div>
    <p class="text-center text-[10px] text-slate-400 dark:text-gray-600 mt-2">
      {{ languageStore.t('chat.poweredBy') }}
    </p>
  </div>
</template>
