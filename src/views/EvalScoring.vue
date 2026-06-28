<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Upload, Download, ChevronLeft, ChevronRight, FileJson, BarChart3, Gauge } from 'lucide-vue-next';
import { useEvalData } from '../composables/useEvalData.js';
import { useSystemMetrics } from '../composables/useSystemMetrics.js';
import SystemMetricsPanel from '../components/eval/SystemMetricsPanel.vue';
import RagasDashboard from '../components/eval/RagasDashboard.vue';
import EvalContentViewer from '../components/eval/EvalContentViewer.vue';

const {
  evalData, currentIndex, humanScores, comments, loading,
  currentItem, stats, handleFileUpload, setScore, exportScores,
  prevItem, nextItem,
} = useEvalData();

const {
  systemMetrics, metricsLoading, metricsTab,
  fetchMetrics, switchTab, formatLatency, getLatencyColor, getCoverageColor,
} = useSystemMetrics();

const showStats = ref(false);

// 分数颜色工具
function getScoreLabel(score) {
  return ['', '很差', '较差', '一般', '较好', '很好'][score] || '';
}
function getScoreColor(score) {
  if (score >= 0.8) return 'text-green-600';
  if (score >= 0.6) return 'text-yellow-600';
  if (score >= 0.4) return 'text-orange-600';
  return 'text-red-600';
}
function getScoreBg(score) {
  if (score >= 0.8) return 'bg-green-50 dark:bg-green-900/20';
  if (score >= 0.6) return 'bg-yellow-50 dark:bg-yellow-900/20';
  if (score >= 0.4) return 'bg-orange-50 dark:bg-orange-900/20';
  return 'bg-red-50 dark:bg-red-900/20';
}

// RAGAS 指标均值
function getMetricAvg(metric) {
  if (!evalData.value?.results) return 0;
  const validResults = evalData.value.results.filter(r => r.metrics && r.metrics[metric] !== undefined);
  if (validResults.length === 0) return 0;
  const sum = validResults.reduce((s, r) => s + (r.metrics[metric] || 0), 0);
  return Math.round((sum / validResults.length) * 100);
}

// 键盘快捷键
function handleKeydown(e) {
  if (e.key === 'ArrowLeft') prevItem();
  if (e.key === 'ArrowRight') nextItem();
  if (e.key >= '1' && e.key <= '5' && currentItem.value) {
    setScore(currentItem.value.id, parseInt(e.key));
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
    <!-- 标题栏 -->
    <div class="max-w-5xl mx-auto mb-6">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <BarChart3 :size="28" />
          RAG 人工评测
        </h1>
        <div class="flex gap-2">
          <label
            class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition">
            <Upload :size="16" />
            加载评测结果
            <input type="file" accept=".json" @change="handleFileUpload" class="hidden" />
          </label>
          <button v-if="evalData" @click="exportScores"
            class="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
            <Download :size="16" />
            导出打分
          </button>
          <button v-if="evalData" @click="showStats = !showStats"
            class="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition">
            <FileJson :size="16" />
            统计
          </button>
        </div>
      </div>
    </div>

    <!-- Tab 切换 -->
    <div class="max-w-5xl mx-auto mb-4">
      <div class="flex items-center gap-1 bg-white dark:bg-gray-800 p-1 rounded-lg border border-slate-200 dark:border-gray-700 w-fit">
        <button @click="switchTab(false)"
          :class="['px-4 py-1.5 rounded-md text-sm font-medium transition-all', !metricsTab ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300']">
          评测内容
        </button>
        <button @click="switchTab(true)"
          :class="['px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5', metricsTab ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300']">
          <Gauge :size="14" />
          系统指标
          <span v-if="systemMetrics" class="text-[10px] opacity-70">LIVE</span>
        </button>
      </div>
    </div>

    <!-- 系统指标面板 -->
    <SystemMetricsPanel v-if="metricsTab"
      :system-metrics="systemMetrics"
      :metrics-loading="metricsLoading"
      :format-latency="formatLatency"
      :get-latency-color="getLatencyColor"
      :get-coverage-color="getCoverageColor"
      @refresh="fetchMetrics"
    />

    <!-- RAGAS Dashboard & SSE 终端 -->
    <RagasDashboard v-if="evalData && !metricsTab"
      :eval-data="evalData"
      :get-metric-avg="getMetricAvg"
    />

    <!-- 统计面板 -->
    <div v-if="showStats && stats" class="max-w-5xl mx-auto mb-6 p-4 bg-white dark:bg-gray-800 rounded-xl shadow">
      <div class="grid grid-cols-5 gap-4 text-center">
        <div>
          <div class="text-2xl font-bold text-blue-600">{{ stats.total }}</div>
          <div class="text-sm text-gray-500">总样本</div>
        </div>
        <div>
          <div class="text-2xl font-bold text-green-600">{{ stats.scored }}</div>
          <div class="text-sm text-gray-500">已打分</div>
        </div>
        <div>
          <div class="text-2xl font-bold text-orange-600">{{ stats.remaining }}</div>
          <div class="text-sm text-gray-500">待打分</div>
        </div>
        <div>
          <div class="text-2xl font-bold text-purple-600">{{ stats.avgHuman }}</div>
          <div class="text-sm text-gray-500">人工均分</div>
        </div>
        <div>
          <div class="text-2xl font-bold text-red-600">{{ stats.avgRagas }}</div>
          <div class="text-sm text-gray-500">RAGAS 均分</div>
        </div>
      </div>
    </div>

    <!-- 未加载状态 -->
    <div v-if="!evalData" class="max-w-5xl mx-auto">
      <div class="text-center py-20">
        <FileJson :size="64" class="mx-auto text-gray-300 mb-4" />
        <p class="text-gray-500 text-lg mb-2">请加载评测结果 JSON 文件</p>
        <p class="text-gray-400 text-sm">
          文件路径: <code class="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">scripts/rag-eval/results/eval-report.json</code>
        </p>
        <p class="text-gray-400 text-sm mt-2">
          或 <code class="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">ragas-results.json</code>
        </p>
      </div>
    </div>

    <!-- 评测内容 -->
    <EvalContentViewer v-if="currentItem"
      :current-item="currentItem"
      :current-index="currentIndex"
      :total-items="evalData.results.length"
      :human-scores="humanScores"
      :comments="comments"
      :get-score-label="getScoreLabel"
      :get-score-color="getScoreColor"
      :get-score-bg="getScoreBg"
      @set-score="setScore"
      @prev="prevItem"
      @next="nextItem"
    />
  </div>
</template>
