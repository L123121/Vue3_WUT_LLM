<script setup>
import { ref, watch, nextTick, computed } from 'vue';
import { Send, Sparkles, Wifi, WifiOff, BookOpen, Command, Search, Trash2, Download } from 'lucide-vue-next';
import { useLanguageStore } from '../../stores/language.store.js';
import { useChatStore } from '../../stores/chat.store.js';
import { useToastStore } from '../../stores/toast.store.js';
import VoiceRecorder from './VoiceRecorder.vue';

const props = defineProps({
  isLoading: Boolean,
  placeholder: String,
  isConnected: { type: Boolean, default: true },
  isReconnecting: { type: Boolean, default: false },
  reconnectAttempt: { type: Number, default: 0 },
});

const emit = defineEmits(['send', 'error', 'command']);
const languageStore = useLanguageStore();
const chatStore = useChatStore();
const toast = useToastStore();
const input = ref('');
const textareaRef = ref(null);
const debouncedInput = ref('');
const enableRag = ref(false);
const showCommands = ref(false);
const selectedCommandIndex = ref(0);
let debounceTimer = null;

// 快捷命令列表
const commands = computed(() => [
  { key: '/clear', label: '清空会话', icon: Trash2, action: () => chatStore.clearMessages() },
  { key: '/export', label: '导出对话', icon: Download, action: () => emit('command', 'export') },
]);

// 过滤匹配的命令
const filteredCommands = computed(() => {
  if (!input.value.startsWith('/')) return [];
  const query = input.value.toLowerCase();
  return commands.value.filter(cmd => cmd.key.startsWith(query));
});

// 监听输入，显示命令菜单
watch(input, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debouncedInput.value = val;
  }, 150);

  // 显示/隐藏命令菜单
  if (val.startsWith('/') && filteredCommands.value.length > 0) {
    showCommands.value = true;
    selectedCommandIndex.value = 0;
  } else {
    showCommands.value = false;
  }
});

const handleSend = async () => {
  if (!input.value.trim() || props.isLoading) return;

  // 如果是命令，执行命令
  if (input.value.startsWith('/')) {
    const matchedCmd = commands.value.find(cmd => cmd.key === input.value.trim());
    if (matchedCmd) {
      matchedCmd.action();
      input.value = '';
      showCommands.value = false;
      return;
    }
  }

  const message = input.value.trim();
  input.value = '';
  showCommands.value = false;
  emit('send', message, enableRag.value);
  await nextTick();
  textareaRef.value?.focus();
};

const handleKeydown = (event) => {
  // 命令菜单导航
  if (showCommands.value) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedCommandIndex.value = Math.min(selectedCommandIndex.value + 1, filteredCommands.value.length - 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedCommandIndex.value = Math.max(selectedCommandIndex.value - 1, 0);
      return;
    }
    if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault();
      selectCommand(filteredCommands.value[selectedCommandIndex.value]);
      return;
    }
    if (event.key === 'Escape') {
      showCommands.value = false;
      return;
    }
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
};

const selectCommand = (cmd) => {
  input.value = cmd.key + ' ';
  showCommands.value = false;
  textareaRef.value?.focus();
};

const executeCommand = (cmd) => {
  cmd.action();
  input.value = '';
  showCommands.value = false;
};

const handleTranscript = (text) => {
  input.value += text;
};

const toggleRag = () => {
  enableRag.value = !enableRag.value;
  if (enableRag.value) {
    toast.success('知识库已开启，AI 将根据知识库内容回答');
  } else {
    toast.info('知识库已关闭，使用普通模式');
  }
};

defineExpose({
  focus: () => textareaRef.value?.focus(),
  clear: () => { input.value = ''; },
});
</script>

<template>
  <div class="p-2 bg-white dark:bg-gray-900 border-t border-slate-100 dark:border-gray-800 z-10">
    <!-- 连接状态提示（优化版：更明显） -->
    <Transition name="slide-down">
      <div v-if="!isConnected || isReconnecting" class="mb-2 p-2 rounded-lg flex items-center justify-center gap-2 text-xs font-medium animate-pulse-subtle"
        :class="isReconnecting ? 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'">
        <div class="relative">
          <WifiOff v-if="!isConnected" :size="14" class="text-red-500" />
          <Wifi v-else :size="14" class="text-yellow-500 animate-pulse" />
          <!-- 重连动画圆环 -->
          <svg v-if="isReconnecting" class="absolute inset-0 animate-spin-slow" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4" stroke-dashoffset="10" class="text-yellow-400" />
          </svg>
        </div>
        <span :class="isReconnecting ? 'text-yellow-700 dark:text-yellow-300' : 'text-red-600 dark:text-red-400'">
          <template v-if="isReconnecting">
            正在重连中... ({{ reconnectAttempt }})
          </template>
          <template v-else>
            连接已断开
          </template>
        </span>
      </div>
    </Transition>

    <div class="relative flex items-center gap-1.5 bg-slate-100 dark:bg-gray-800 rounded-xl p-1.5 border border-transparent focus-within:border-blue-300 dark:focus-within:border-blue-700 focus-within:bg-white dark:focus-within:bg-gray-800 focus-within:ring-2 focus-within:ring-blue-100 dark:focus-within:ring-blue-900/20 transition-all duration-300">
      <!-- 快捷命令菜单 -->
      <Transition name="command-menu">
        <div v-if="showCommands" class="absolute bottom-full left-0 mb-2 w-64 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-slate-200 dark:border-gray-700 overflow-hidden z-20">
          <div class="px-3 py-2 bg-slate-50 dark:bg-gray-900 border-b border-slate-100 dark:border-gray-700">
            <div class="flex items-center gap-2 text-xs text-slate-500 dark:text-gray-400">
              <Command :size="12" />
              <span>快捷命令</span>
            </div>
          </div>
          <div class="py-1">
            <button
              v-for="(cmd, index) in filteredCommands"
              :key="cmd.key"
              @click="executeCommand(cmd)"
              :class="[
                'w-full px-3 py-2 flex items-center gap-3 text-left transition-colors',
                index === selectedCommandIndex
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                  : 'hover:bg-slate-50 dark:hover:bg-gray-700 text-slate-700 dark:text-gray-200'
              ]"
            >
              <component :is="cmd.icon" :size="16" class="text-slate-400 dark:text-gray-500" />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">{{ cmd.key }}</div>
                <div class="text-xs text-slate-400 dark:text-gray-500">{{ cmd.label }}</div>
              </div>
            </button>
          </div>
          <div class="px-3 py-1.5 bg-slate-50 dark:bg-gray-900 border-t border-slate-100 dark:border-gray-700 flex items-center gap-3 text-[10px] text-slate-400 dark:text-gray-500">
            <span>↑↓ 导航</span>
            <span>Tab 选择</span>
            <span>Esc 关闭</span>
          </div>
        </div>
      </Transition>

      <!-- 知识库开关 -->
      <button
        @click="toggleRag"
        :title="enableRag ? '知识库已开启：AI 将根据知识库内容回答' : '知识库已关闭：使用普通模式'"
        :class="[
          'shrink-0 h-8 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-xs font-medium transition-all duration-200 border',
          enableRag
            ? 'bg-violet-50 dark:bg-violet-900/30 border-violet-300 dark:border-violet-600 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/50'
            : 'bg-white dark:bg-gray-800 border-slate-200 dark:border-gray-700 text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-700 hover:text-slate-700 dark:hover:text-gray-200'
        ]"
      >
        <BookOpen :size="13" />
        <span>{{ enableRag ? '知识库' : '知识库' }}</span>
      </button>

      <textarea
        ref="textareaRef"
        v-model="input"
        @keydown="handleKeydown"
        :placeholder="placeholder || languageStore.t('chat.inputPlaceholder')"
        :disabled="isLoading || !isConnected"
        rows="1"
        class="w-full bg-transparent text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-gray-500 border-none focus:ring-0 px-1 py-1.5 outline-none resize-none max-h-24 text-sm disabled:opacity-50"
        style="min-height: 32px;"
      ></textarea>

      <VoiceRecorder :disabled="isLoading || !isConnected" @transcript="handleTranscript" @error="(message) => emit('error', message)" />

      <button
        @click="handleSend"
        :disabled="!input.trim() || isLoading || !isConnected"
        :class="[
          'p-2 rounded-lg transition-all duration-300 shrink-0',
          !input.trim() || isLoading || !isConnected ? 'bg-slate-200 text-slate-400 dark:bg-gray-700 dark:text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-500/20 active:scale-95'
        ]"
      >
        <Sparkles v-if="isLoading" :size="16" class="animate-spin" />
        <Send v-else :size="16" />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 滑入动画 */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
}

.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* 缓慢旋转动画 */
.animate-spin-slow {
  animation: spin 2s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* 微弱脉冲动画 */
.animate-pulse-subtle {
  animation: pulse-subtle 2s ease-in-out infinite;
}

@keyframes pulse-subtle {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.85;
  }
}

/* 命令菜单动画 */
.command-menu-enter-active,
.command-menu-leave-active {
  transition: all 0.2s ease;
}

.command-menu-enter-from,
.command-menu-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
