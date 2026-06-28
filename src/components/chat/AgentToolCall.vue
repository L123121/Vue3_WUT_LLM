<script setup>
import { computed } from 'vue';
import {
  Wrench,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Check,
} from 'lucide-vue-next';

const props = defineProps({
  toolCall: { type: Object, default: null },
});

const statusConfig = computed(() => {
  const status = props.toolCall?.status;
  switch (status) {
    case 'done':
      return {
        bg: 'bg-emerald-50 dark:bg-emerald-900/15',
        border: 'border-emerald-200 dark:border-emerald-800/60',
        icon: CheckCircle2,
        iconClass: 'text-emerald-500',
        label: '已完成',
        labelClass: 'text-emerald-600 dark:text-emerald-400',
      };
    case 'error':
      return {
        bg: 'bg-red-50 dark:bg-red-900/15',
        border: 'border-red-200 dark:border-red-800/60',
        icon: AlertTriangle,
        iconClass: 'text-red-500',
        label: '失败',
        labelClass: 'text-red-600 dark:text-red-400',
      };
    case 'running':
      return {
        bg: 'bg-blue-50 dark:bg-blue-900/15',
        border: 'border-blue-200 dark:border-blue-800/60',
        icon: Loader2,
        iconClass: 'text-blue-500 animate-spin',
        label: '执行中',
        labelClass: 'text-blue-600 dark:text-blue-400',
      };
    default:
      return {
        bg: 'bg-slate-50 dark:bg-gray-800',
        border: 'border-slate-200 dark:border-gray-700',
        icon: Wrench,
        iconClass: 'text-slate-500',
        label: '等待',
        labelClass: 'text-slate-500',
      };
  }
});
</script>

<template>
  <div v-if="toolCall" class="flex items-start gap-2 text-xs animate-fade-in">
    <!-- 状态圆点 -->
    <span class="shrink-0 mt-0.5">
      <span
        v-if="toolCall.completed || toolCall.status === 'done'"
        class="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30"
      >
        <Check :size="8" class="text-emerald-600 dark:text-emerald-400" />
      </span>
      <span
        v-else
        class="block w-2 h-2 rounded-full"
        :class="toolCall.status === 'error' ? 'bg-red-400' : 'bg-blue-400 animate-pulse'"
      />
    </span>

    <!-- 工具调用卡片（不可展开） -->
    <span
      class="flex-1 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5"
      :class="statusConfig.bg + ' ' + statusConfig.border"
    >
      <component :is="statusConfig.icon" :size="13" :class="statusConfig.iconClass" />
      <span class="truncate text-[11px] text-slate-700 dark:text-gray-200">
        {{ toolCall.name }}
      </span>
      <span
        v-if="toolCall.completed || toolCall.status === 'done'"
        class="ml-auto text-emerald-500 text-[10px] shrink-0"
      >
        已完成
      </span>
      <span
        v-else
        class="ml-auto px-1.5 py-0.5 rounded-md text-[10px] font-medium"
        :class="statusConfig.labelClass + ' ' + statusConfig.bg"
      >
        {{ statusConfig.label }}
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
