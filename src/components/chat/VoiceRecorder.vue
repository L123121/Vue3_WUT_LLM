<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { Mic } from 'lucide-vue-next';
import { useLanguageStore } from '../../stores/language.store.js';

const emit = defineEmits(['transcript', 'error', 'statusChange']);
defineProps({ disabled: Boolean });
const languageStore = useLanguageStore();
const recognizing = ref(false);
let recognition = null;

const getSpeechRecognition = () => {
  if (typeof window === 'undefined') return null;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  return SR ? new SR() : null;
};

const initRecognition = () => {
  recognition = getSpeechRecognition();
  if (!recognition) return;
  recognition.lang = 'zh-CN';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onstart = () => { recognizing.value = true; emit('statusChange', 'recording'); };
  recognition.onresult = (event) => {
    emit('transcript', event.results[0][0].transcript);
    recognizing.value = false;
    emit('statusChange', 'idle');
  };
  recognition.onerror = (event) => {
    recognizing.value = false;
    emit('statusChange', 'idle');
    const code = event.error;
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      emit('error', '未授予麦克风权限');
      return;
    }
    if (code === 'no-speech') {
      emit('error', '未检测到语音，请重试');
      return;
    }
    emit('error', '语音识别出错');
  };
  recognition.onend = () => { recognizing.value = false; emit('statusChange', 'idle'); };
};

const startVoiceInput = () => {
  if (!recognition) {
    emit('error', '当前浏览器不支持语音识别（建议使用 Chrome）');
    return;
  }
  if (!window.isSecureContext) {
    emit('error', '语音识别需要安全环境（https 或 localhost）');
    return;
  }
  if (recognizing.value) {
    try { recognition.abort(); } catch {}
    return;
  }
  try {
    recognition.start();
  } catch (error) {
    console.error('SpeechRecognition start error:', error);
    emit('error', '语音识别启动失败');
  }
};

const stopVoiceInput = () => {
  if (recognition && recognizing.value) {
    try { recognition.stop(); } catch {}
  }
};

onMounted(initRecognition);
onUnmounted(stopVoiceInput);
defineExpose({ startVoiceInput, stopVoiceInput, isRecording: recognizing });
</script>

<template>
  <button @click="startVoiceInput" :disabled="disabled" :class="['p-2.5 rounded-xl transition-all duration-300 mb-0.5 shrink-0', recognizing ? 'bg-green-500 text-white animate-pulse' : 'bg-slate-200 text-slate-400 dark:bg-gray-700 dark:text-gray-500 hover:bg-blue-100 hover:text-blue-600', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer']" :title="languageStore.t('chat.voiceInput')">
    <Mic v-if="!recognizing" :size="20" />
    <Mic v-else :size="20" class="animate-pulse" />
  </button>
</template>
