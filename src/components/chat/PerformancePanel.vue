<script setup>
import { ref, computed, onMounted } from 'vue';
import { usePerformanceMonitor, initDemoData } from '../../utils/performance.js';
import { Activity, RefreshCw, Trash2, TrendingUp, TrendingDown, Minus } from 'lucide-vue-next';

const monitor = usePerformanceMonitor();
const stats = ref({});
const recentMetrics = ref([]);
const showDemoPrompt = ref(false);

const loadStats = () => {
  stats.value = monitor.getStats();
  recentMetrics.value = monitor.getRecentMetrics(20);
};

const handleRefresh = () => {
  loadStats();
};

const handleClear = () => {
  monitor.clearMetrics();
  loadStats();
};

const handleInitDemo = () => {
  initDemoData();
  loadStats();
  showDemoPrompt.value = false;
};

const metricLabels = {
  LCP: '最大内容绘制',
  FID: '首次输入延迟',
  CLS: '累积布局偏移',
  FCP: '首次内容绘制',
  TTFB: '首字节时间',
};

const metricUnits = {
  LCP: 'ms',
  FID: 'ms',
  CLS: '',
  FCP: 'ms',
  TTFB: 'ms',
};

const getRatingColor = (rating) => {
  switch (rating) {
    case 'good':
      return 'text-green-500 bg-green-100 dark:bg-green-900/30';
    case 'needs-improvement':
      return 'text-yellow-500 bg-yellow-100 dark:bg-yellow-900/30';
    case 'poor':
      return 'text-red-500 bg-red-100 dark:bg-red-900/30';
    default:
      return 'text-gray-500 bg-gray-100 dark:bg-gray-800';
  }
};

const getRatingText = (rating) => {
  switch (rating) {
    case 'good':
      return '良好';
    case 'needs-improvement':
      return '需改进';
    case 'poor':
      return '较差';
    default:
      return '未知';
  }
};

const getTrendIcon = (name) => {
  const stat = stats.value[name];
  if (!stat) return Minus;
  const diff = stat.latest - stat.avg;
  if (diff > stat.threshold?.good * 0.1) return TrendingUp;
  if (diff < -stat.threshold?.good * 0.1) return TrendingDown;
  return Minus;
};

const getTrendColor = (name) => {
  const stat = stats.value[name];
  if (!stat) return 'text-gray-400';
  const diff = stat.latest - stat.avg;
  // 对于 CLS 和延迟指标，下降是好的
  const isLowerBetter = true;
  if (isLowerBetter) {
    if (diff > stat.threshold?.good * 0.1) return 'text-red-500';
    if (diff < -stat.threshold?.good * 0.1) return 'text-green-500';
  }
  return 'text-gray-400';
};

const formatValue = (name, value) => {
  if (name === 'CLS') {
    return value.toFixed(3);
  }
  return Math.round(value).toLocaleString();
};

onMounted(() => {
  // 检查是否有数据
  if (Object.keys(monitor.getStats()).length === 0) {
    showDemoPrompt.value = true;
  }
  loadStats();
});
</script>

<template>
  <div class="p-4 space-y-4">
    <!-- 标题 -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Activity :size="18" class="text-blue-500" />
        <h3 class="text-sm font-bold text-slate-800 dark:text-white">性能监控</h3>
      </div>
      <div class="flex items-center gap-1">
        <button
          @click="handleRefresh"
          class="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          title="刷新"
        >
          <RefreshCw :size="14" />
        </button>
        <button
          @click="handleClear"
          class="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          title="清除数据"
        >
          <Trash2 :size="14" />
        </button>
      </div>
    </div>

    <!-- 演示数据提示 -->
    <div v-if="showDemoPrompt" class="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
      <p class="text-xs text-blue-700 dark:text-blue-300 mb-2">暂无性能数据，是否加载演示数据？</p>
      <button
        @click="handleInitDemo"
        class="px-3 py-1 rounded-lg text-xs bg-blue-500 text-white hover:bg-blue-600 transition-colors"
      >
        加载演示数据
      </button>
    </div>

    <!-- 指标卡片 -->
    <div class="grid grid-cols-2 gap-3">
      <div
        v-for="(stat, name) in stats"
        :key="name"
        class="p-3 rounded-xl bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700"
      >
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-medium text-slate-600 dark:text-gray-400">{{ metricLabels[name] }}</span>
          <span :class="['px-1.5 py-0.5 rounded text-[10px] font-medium', getRatingColor(stat.rating)]">
            {{ getRatingText(stat.rating) }}
          </span>
        </div>

        <div class="flex items-end gap-1 mb-2">
          <span class="text-2xl font-bold text-slate-800 dark:text-white">{{ formatValue(name, stat.latest) }}</span>
          <span class="text-xs text-slate-400 mb-1">{{ metricUnits[name] }}</span>
          <component :is="getTrendIcon(name)" :size="14" :class="['mb-1', getTrendColor(name)]" />
        </div>

        <div class="grid grid-cols-3 gap-2 text-[10px]">
          <div>
            <span class="text-slate-400">平均</span>
            <p class="font-medium text-slate-600 dark:text-gray-300">{{ formatValue(name, stat.avg) }}</p>
          </div>
          <div>
            <span class="text-slate-400">最小</span>
            <p class="font-medium text-slate-600 dark:text-gray-300">{{ formatValue(name, stat.min) }}</p>
          </div>
          <div>
            <span class="text-slate-400">最大</span>
            <p class="font-medium text-slate-600 dark:text-gray-300">{{ formatValue(name, stat.max) }}</p>
          </div>
        </div>

        <div class="mt-2 pt-2 border-t border-slate-200 dark:border-gray-700">
          <div class="text-[10px] text-slate-400">
            阈值: 良好 ≤{{ formatValue(name, stat.threshold.good) }} | 需改进 ≤{{ formatValue(name, stat.threshold.needsImprovement) }}
          </div>
        </div>
      </div>
    </div>

    <!-- 最近记录 -->
    <div v-if="recentMetrics.length > 0" class="mt-4">
      <h4 class="text-xs font-bold text-slate-500 dark:text-gray-400 mb-2 uppercase tracking-wide">最近记录</h4>
      <div class="space-y-1 max-h-48 overflow-y-auto">
        <div
          v-for="metric in recentMetrics.slice().reverse()"
          :key="metric.id"
          class="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-gray-800/50"
        >
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium text-slate-700 dark:text-gray-300">{{ metricLabels[metric.name] }}</span>
            <span :class="['px-1 py-0.5 rounded text-[9px] font-medium', getRatingColor(metric.rating)]">
              {{ getRatingText(metric.rating) }}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-mono text-slate-600 dark:text-gray-400">
              {{ formatValue(metric.name, metric.value) }}{{ metricUnits[metric.name] }}
            </span>
            <span class="text-[10px] text-slate-400">
              {{ new Date(metric.timestamp).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="Object.keys(stats).length === 0 && !showDemoPrompt" class="text-center py-8">
      <Activity :size="32" class="mx-auto text-slate-300 dark:text-gray-600 mb-2" />
      <p class="text-xs text-slate-400 dark:text-gray-500">暂无性能数据</p>
      <p class="text-[10px] text-slate-300 dark:text-gray-600 mt-1">浏览页面后将自动收集</p>
    </div>
  </div>
</template>

