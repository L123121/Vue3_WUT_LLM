<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import { Mic, MicOff, AlertCircle } from 'lucide-vue-next';

const emit = defineEmits(['transcript', 'interim', 'error', 'state-change']);
defineProps({ disabled: Boolean });

// ==================== 状态机 ====================
// idle: 空闲 | listening: 麦克风激活等待语音 | recognizing: 识别中（有 interim） | error: 出错
const state = ref('idle');
const recognizing = ref(false);
const interimText = ref('');
const errorMessage = ref('');

let recognition = null;
let processedIndex = 0; // 防重叠游标

// ==================== 识别成功率统计（简历/性能数据用） ====================
// 口径：一次会话（start→end）产生 final 转写 → 成功；onerror（aborted 除外）→ 失败
const VOICE_STATS_KEY = 'voice_recognition_stats';
let voiceStats = { success: 0, fail: 0 };
let sessionFinal = false;   // 本次会话是否产出了 final 转写
let sessionFailed = false;  // 本次会话是否已记失败（避免 onend 重复计数）
try {
  const saved = JSON.parse(localStorage.getItem(VOICE_STATS_KEY) || '{}');
  voiceStats.success = saved.success || 0;
  voiceStats.fail = saved.fail || 0;
} catch { /* localStorage 不可用时忽略 */ }

const persistVoiceStats = () => {
  try {
    localStorage.setItem(VOICE_STATS_KEY, JSON.stringify(voiceStats));
  } catch {}
};

const logVoiceStats = () => {
  const total = voiceStats.success + voiceStats.fail;
  if (total === 0) return;
  const rate = ((voiceStats.success / total) * 100).toFixed(1);
  console.debug(`[VoiceStats] 识别成功率: ${rate}% (success=${voiceStats.success}, fail=${voiceStats.fail})`);
  persistVoiceStats();
};

// ==================== 音频可视化 ====================
let audioCtx = null;
let analyser = null;
let audioStream = null;
let rafId = null;
const canvasRef = ref(null);

const getSpeechRecognition = () => {
  if (typeof window === 'undefined') return null;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  return SR ? new SR() : null;
};

// 绘制实时波形（时域示波器风格）
const drawWaveform = () => {
  if (!analyser || !canvasRef.value) return;
  const canvas = canvasRef.value;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  // 适配高 DPI
  const resize = () => {
    const { clientWidth, clientHeight } = canvas;
    if (clientWidth === 0 || clientHeight === 0) return;
    canvas.width = clientWidth * dpr;
    canvas.height = clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  const draw = () => {
    if (!analyser) return;
    rafId = requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(dataArray);

    const { width, height } = canvas;
    const cssWidth = width / dpr;
    const cssHeight = height / dpr;
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    // 根据状态切换颜色
    const color = state.value === 'recognizing' ? '#3b82f6' : '#94a3b8';
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.beginPath();

    const sliceWidth = cssWidth / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * cssHeight) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.lineTo(cssWidth, cssHeight / 2);
    ctx.stroke();
  };
  draw();

  // 监听尺寸变化
  window.addEventListener('resize', resize);
};

const setupAudioVisualization = async () => {
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const source = audioCtx.createMediaStreamSource(audioStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    drawWaveform();
  } catch (err) {
    // 音频可视化失败不阻塞语音识别（用户可能只授权了语音识别的"伪"麦克风）
    console.warn('[VoiceRecorder] 音频可视化初始化失败:', err.message);
  }
};

const stopAudioVisualization = () => {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (audioStream) { audioStream.getTracks().forEach((t) => t.stop()); audioStream = null; }
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
  analyser = null;
  // 清空画布
  const canvas = canvasRef.value;
  if (canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  }
};

// ==================== 语音识别 ====================
const initRecognition = () => {
  recognition = getSpeechRecognition();
  if (!recognition) return;
  recognition.lang = 'zh-CN';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onstart = () => {
    processedIndex = 0;
    interimText.value = '';
    errorMessage.value = '';
    state.value = 'listening';
    recognizing.value = true;
    // 新会话重置统计标志
    sessionFinal = false;
    sessionFailed = false;
    emit('state-change', 'listening');
    // nextTick 保证 v-if="state === 'listening'" 的 canvas 已渲染到 DOM
    nextTick().then(() => setupAudioVisualization());
  };

  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    const start = Math.max(event.resultIndex, processedIndex);
    for (let i = start; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        final += transcript;
        // 产生 final 转写即记为成功会话
        if (transcript.trim()) sessionFinal = true;
      } else if (i >= event.resultIndex) {
        interim += transcript;
      }
    }
    processedIndex = event.results.length;

    if (interim) {
      interimText.value = interim;
      if (state.value !== 'recognizing') {
        state.value = 'recognizing';
        emit('state-change', 'recognizing');
      }
      emit('interim', interim);
    }
    if (final) {
      emit('transcript', final);
      interimText.value = '';
      emit('interim', '');
    }
  };

  recognition.onerror = (event) => {
    recognizing.value = false;
    stopAudioVisualization();
    const code = event.error;
    // 统计失败：aborted（用户主动取消）不计入失败
    if (code !== 'aborted' && !sessionFailed) {
      sessionFailed = true;
      voiceStats.fail += 1;
    }
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      errorMessage.value = '未授予麦克风权限';
    } else if (code === 'no-speech') {
      errorMessage.value = '未检测到语音，请重试';
    } else if (code === 'aborted') {
      errorMessage.value = '语音识别已取消';
    } else if (code === 'network') {
      errorMessage.value = '网络错误，语音识别失败';
    } else if (code === 'audio-capture') {
      errorMessage.value = '未找到麦克风设备';
    } else {
      errorMessage.value = `语音识别出错: ${code}`;
    }
    state.value = 'error';
    emit('state-change', 'error');
    emit('error', errorMessage.value);
  };

  recognition.onend = () => {
    recognizing.value = false;
    stopAudioVisualization();
    // 统计成功：会话结束且产出过 final 转写且未记失败 → 成功
    if (sessionFinal && !sessionFailed) {
      voiceStats.success += 1;
      logVoiceStats();
    } else if (sessionFailed) {
      logVoiceStats();
    }
    if (state.value !== 'error') {
      state.value = 'idle';
      emit('state-change', 'idle');
    }
    interimText.value = '';
    emit('interim', '');
  };
};

// ==================== 控制 ====================
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
    try { recognition.stop(); } catch (err) {
      console.warn('[VoiceRecorder] 停止录音失败:', err.message);
    }
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
    try { recognition.stop(); } catch (err) {
      console.warn('[VoiceRecorder] 停止录音失败:', err.message);
    }
  }
  stopAudioVisualization();
};

onMounted(initRecognition);
onUnmounted(() => {
  stopAudioVisualization();
  if (recognition) {
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try { recognition.abort(); } catch { /* ignore */ }
  }
});

defineExpose({ startVoiceInput, stopVoiceInput, isRecording: recognizing, state });
</script>

<template>
  <div class="flex items-center gap-1 shrink-0">
    <!-- 错误提示 -->
    <Transition name="fade">
      <div v-if="state === 'error'" class="flex items-center gap-1 text-red-500 text-xs" :title="errorMessage">
        <AlertCircle :size="14" />
      </div>
    </Transition>

    <!-- 波形可视化（聆听/识别中显示） -->
    <Transition name="expand">
      <canvas
        v-if="state === 'listening' || state === 'recognizing'"
        ref="canvasRef"
        class="h-8 w-20 rounded bg-slate-50 dark:bg-slate-900/40"
      ></canvas>
    </Transition>

    <!-- 主按钮 -->
    <button
      type="button"
      @click="startVoiceInput"
      :disabled="disabled"
      :class="[
        'relative shrink-0 h-9 w-9 inline-flex items-center justify-center rounded-xl transition-all duration-300',
        state === 'error'
          ? 'bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400'
          : state === 'recognizing'
            ? 'bg-wut-500 text-white shadow-lg shadow-wut-500/30 animate-pulse'
            : state === 'listening'
              ? 'bg-green-500 text-white shadow-lg shadow-green-500/30'
              : 'bg-slate-200 text-slate-400 dark:bg-gray-700 dark:text-gray-500 hover:bg-wut-100 hover:text-wut-600',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      ]"
      :title="state === 'error' ? errorMessage : (recognizing ? '点击停止录音' : '点击开始语音输入')"
    >
      <MicOff v-if="state === 'error'" :size="18" />
      <Mic v-else :size="18" />
    </button>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.expand-enter-active,
.expand-leave-active {
  transition: all 0.3s ease;
}
.expand-enter-from,
.expand-leave-to {
  width: 0;
  opacity: 0;
  margin: 0;
}
</style>
