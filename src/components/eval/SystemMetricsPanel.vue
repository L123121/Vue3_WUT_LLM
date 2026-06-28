<script setup>
import { RefreshCw } from 'lucide-vue-next';

defineProps({
  systemMetrics: { type: Object, default: null },
  metricsLoading: { type: Boolean, default: false },
  formatLatency: { type: Function, required: true },
  getLatencyColor: { type: Function, required: true },
  getCoverageColor: { type: Function, required: true },
});

defineEmits(['refresh']);
</script>

<template>
  <div class="max-w-5xl mx-auto mb-6 space-y-4">
    <!-- 延迟指标 -->
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-slate-100 dark:border-gray-700 p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-base font-bold text-slate-800 dark:text-white flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          响应延迟 (ms)
        </h2>
        <button @click="$emit('refresh')" :disabled="metricsLoading"
          class="flex items-center gap-1 px-3 py-1 text-xs text-slate-500 hover:text-blue-600 disabled:opacity-40 transition">
          <RefreshCw :size="12" :class="{'animate-spin': metricsLoading}" />
          刷新
        </button>
      </div>
      <div v-if="systemMetrics?.latency" class="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div v-for="([key, val]) in Object.entries(systemMetrics.latency)" :key="key"
          class="p-3 rounded-lg bg-slate-50 dark:bg-gray-700/50 border border-slate-100 dark:border-gray-600/50">
          <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
            {{ key === 'ai' ? 'LLM 调用' : key === 'chatdoc' ? 'ChatDoc' : key === 'parentChild' ? '父子召回' : key === 'rerank' ? 'Rerank 精排' : key === 'total' ? '端到端' : '教务接口' }}
          </div>
          <div class="text-lg font-bold" :class="getLatencyColor(val.avg)">
            {{ formatLatency(val.avg) }}
          </div>
          <div class="text-[10px] text-slate-400 mt-0.5">
            p95: {{ formatLatency(val.p95) }} | {{ val.count }}次
          </div>
        </div>
      </div>
      <div v-else class="text-center text-slate-400 text-sm py-4">
        暂无延迟数据（需要先发起对话请求）
      </div>
    </div>

    <!-- RAG 检索指标 + 数据清洗 -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- RAG 指标 -->
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-slate-100 dark:border-gray-700 p-5">
        <h2 class="text-base font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-indigo-500"></span>
          RAG 检索指标
        </h2>
        <div v-if="systemMetrics?.rag" class="space-y-2.5">
          <div class="flex justify-between items-center">
            <span class="text-xs text-slate-500">总查询数</span>
            <span class="text-sm font-bold text-slate-700 dark:text-gray-200">{{ systemMetrics.rag.totalQueries }}</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-xs text-slate-500">RAG 查询数</span>
            <span class="text-sm font-bold text-indigo-600">{{ systemMetrics.rag.ragQueries }}</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-xs text-slate-500">父子召回使用次数</span>
            <span class="text-sm font-bold text-emerald-600">{{ systemMetrics.rag.parentChildQueries }}</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-xs text-slate-500">父子召回覆盖率</span>
            <span class="text-sm font-bold" :class="getCoverageColor(systemMetrics.rag.parentChildCoverage)">
              {{ systemMetrics.rag.parentChildCoverage }}
            </span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-xs text-slate-500">平均匹配父文档数</span>
            <span class="text-sm font-bold text-slate-700 dark:text-gray-200">{{ systemMetrics.rag.avgMatchedDocs }} 篇</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-xs text-slate-500">检索切片总数</span>
            <span class="text-sm font-bold text-slate-700 dark:text-gray-200">{{ systemMetrics.rag.totalRetrievedChunks }}</span>
          </div>
        </div>
        <div v-else class="text-center text-slate-400 text-sm py-4">
          暂无 RAG 数据（需要先使用知识库对话）
        </div>
      </div>

      <!-- 数据清洗统计 -->
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-slate-100 dark:border-gray-700 p-5">
        <h2 class="text-base font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-amber-500"></span>
          教务数据清洗统计
        </h2>
        <div v-if="systemMetrics?.cleaning" class="space-y-2.5">
          <div class="flex justify-between items-center">
            <span class="text-xs text-slate-500">处理字段总数</span>
            <span class="text-sm font-bold text-slate-700 dark:text-gray-200">{{ systemMetrics.cleaning.totalFields }}</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-xs text-slate-500">HTML 实体修复</span>
            <span class="text-sm font-bold text-amber-600">{{ systemMetrics.cleaning.htmlEntities }} 次</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-xs text-slate-500">不可见字符清理</span>
            <span class="text-sm font-bold text-red-500">{{ systemMetrics.cleaning.invisibleChars }} 次</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-xs text-slate-500">空白规范化</span>
            <span class="text-sm font-bold text-blue-500">{{ systemMetrics.cleaning.whitespaceFix }} 次</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-xs text-slate-500">空值拦截</span>
            <span class="text-sm font-bold text-orange-500">{{ systemMetrics.cleaning.nullValues }} 次</span>
          </div>
          <div class="border-t border-slate-100 dark:border-gray-700 pt-2 mt-2">
            <div class="flex justify-between items-center">
              <span class="text-xs text-slate-500 font-medium">总拦截次数</span>
              <span class="text-sm font-bold text-slate-800 dark:text-white">{{ systemMetrics.cleaning.totalIntercepted }}</span>
            </div>
            <div class="flex justify-between items-center mt-1">
              <span class="text-xs text-slate-500 font-medium">拦截率</span>
              <span class="text-sm font-bold text-slate-800 dark:text-white">{{ systemMetrics.cleaning.interceptRate }}</span>
            </div>
          </div>
        </div>
        <div v-else class="text-center text-slate-400 text-sm py-4">
          暂无清洗数据（需要先查询成绩/课表/考试）
        </div>
      </div>
    </div>

    <!-- 运行时间 -->
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-slate-100 dark:border-gray-700 p-4 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full" :class="systemMetrics ? 'bg-green-500 animate-pulse' : 'bg-gray-400'"></span>
        <span class="text-xs text-slate-500">服务运行时间</span>
      </div>
      <span class="text-sm font-mono text-slate-600 dark:text-gray-300">{{ systemMetrics?.uptime || '-' }}</span>
      <span class="text-[10px] text-slate-400">{{ systemMetrics?.timestamp ? new Date(systemMetrics.timestamp).toLocaleTimeString() : '' }}</span>
    </div>
  </div>
</template>
