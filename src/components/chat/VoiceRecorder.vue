<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Mic } from 'lucide-vue-next';

// Web Speech API 类型
interface SpeechRecognitionResult {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult[];
  [index: number]: { [index: number]: SpeechRecognitionResult };
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface SpeechRecognitionInterface {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

const emit = defineEmits<{
  (e: 'transcript', text: string): void;
  (e: 'error', message: string): void;
  (e: 'statusChange', status: 'idle' | 'recording' | 'processing'): void;
}>();

defineProps<{
  disabled?: boolean;
}>();

const recognizing = ref(false);
let recognition: SpeechRecognitionInterface | null = null;

const getSpeechRecognition = (): SpeechRecognitionInterface | null => {
  if (typeof window === 'undefined') return null;
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  return SR ? new SR() : null;
};

const initRecognition = () => {
  recognition = getSpeechRecognition();
  if (recognition) {
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'zh-CN';

    recognition.onstart = () => {
      recognizing.value = true;
      emit('statusChange', 'recording');
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript;
      emit('transcript', transcript);
      recognizing.value = false;
      emit('statusChange', 'idle');
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
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

    recognition.onend = () => {
      recognizing.value = false;
      emit('statusChange', 'idle');
    };
  }
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
    try {
      recognition.abort();
    } catch {
      // ignore
    }
    return;
  }
  try {
    recognition.start();
  } catch (err) {
    recognizing.value = false;
    console.error('SpeechRecognition start error:', err);
    emit('error', '语音识别启动失败');
  }
};

const stopVoiceInput = () => {
  if (recognition && recognizing.value) {
    try {
      recognition.stop();
    } catch {
      // ignore
    }
  }
};

onMounted(() => {
  initRecognition();
});

onUnmounted(() => {
  stopVoiceInput();
});

// 暴露给父组件
defineExpose({
  startVoiceInput,
  stopVoiceInput,
  isRecording: recognizing
});
</script>

<template>
  <button
    @click="startVoiceInput"
    :disabled="disabled"
    :class="[
      'p-2.5 rounded-xl transition-all duration-300 mb-0.5 shrink-0',
      recognizing
        ? 'bg-green-500 text-white animate-pulse' 
        : 'bg-slate-200 text-slate-400 dark:bg-gray-700 dark:text-gray-500 hover:bg-blue-100 hover:text-blue-600',
      disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
    ]"
    title="语音输入"
  >
    <Mic v-if="!recognizing" :size="20" />
    <Mic v-else :size="20" class="animate-pulse" />
  </button>
</template>
