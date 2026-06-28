<script setup>
import { computed } from 'vue';
import { Brain, Loader2, Check } from 'lucide-vue-next';

const props = defineProps({
  step: { type: Object, default: null },
  hasReply: { type: Boolean, default: false },
});

// 加载中：是最后一个事件、是"整理结果/分析"类步骤、且 AI 还没回复
const isLoading = computed(() =>
  props.step?.isLast && !props.hasReply
  && (props.step?.content?.includes('整理结果') || props.step?.content?.includes('分析'))
);

const isCompleted = computed(() =>
  !props.step?.isLast || props.hasReply
);
</script>

<template>
  <div v-if="step" class="flex items-start gap-2 text-xs animate-fade-in">
    <!-- 状态图标 -->
    <span class="shrink-0 mt-0.5">
      <span
        v-if="isCompleted"
        class="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30"
      >
        <Check :size="8" class="text-emerald-600 dark:text-emerald-400" />
      </span>
      <span
        v-else-if="isLoading"
        class="block w-2 h-2 rounded-full bg-purple-400 animate-ping"
      />
      <span
        v-else
        class="block w-2 h-2 rounded-full bg-purple-400 dark:bg-purple-500"
      />
    </span>

    <!-- 内容（与 AgentToolCall 保持相同结构确保对齐） -->
    <span
      class="flex items-center gap-1.5 text-[11px] leading-relaxed flex-1 min-w-0 border rounded-lg px-2.5 py-1.5"
      :class="isCompleted
        ? 'text-slate-400 dark:text-gray-500 border-slate-200 dark:border-gray-700'
        : 'text-slate-600 dark:text-gray-300 border-transparent'"
    >
      <Loader2 v-if="isLoading" :size="13" class="text-purple-500 animate-spin shrink-0" />
      <Brain v-else :size="13" class="shrink-0" :class="isCompleted ? 'text-emerald-400' : 'text-purple-500'" />
      <span class="truncate">{{ step.content }}</span>
      <span v-if="isCompleted" class="ml-auto text-emerald-500 text-[10px] shrink-0">已完成</span>
      <span v-if="isLoading" class="inline-flex gap-0.5 shrink-0">
        <span class="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style="animation-delay: 0s" />
        <span class="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style="animation-delay: 0.2s" />
        <span class="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style="animation-delay: 0.4s" />
      </span>
    </span>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.25s ease-out both;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
