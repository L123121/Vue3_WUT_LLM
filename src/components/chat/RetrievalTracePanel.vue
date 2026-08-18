<script setup>
import { ref, computed } from 'vue';
import { Search, ChevronDown, ChevronRight, Clock, RefreshCw, FileSearch, GitBranch } from 'lucide-vue-next';

/**
 * 检索过程可视化面板（RAGFlow 式透明度）
 * 展示 ragTrace 中的检索模式、各阶段耗时、改写 query、rerank 配置。
 */
const props = defineProps({
  trace: { type: Object, default: null },
});

const expanded = ref(false);

const statusLabel = computed(() => {
  const status = props.trace?.status;
  if (status === 'fallback') return '未命中可靠来源';
  if (status === 'error') return '检索异常';
  return '检索成功';
});

const statusClass = computed(() => {
  const status = props.trace?.status;
  if (status === 'fallback') return 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300';
  if (status === 'error') return 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300';
  return 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-300';
});

// 检索汇总
const retrieval = computed(() => props.trace?.retrieval || null);

const modeLabel = computed(() => {
  const mode = retrieval.value?.mode || '';
  const labels = {
    'hybrid_vector_bm25_rrf': '混合检索 (向量+关键词 RRF)',
    'hybrid': '混合检索',
    'vector': '向量检索',
    'keyword': '关键词检索',
  };
  return labels[mode] || mode || '—';
});

const fallbackReason = computed(() => {
  const reason = props.trace?.outcome?.fallbackReason;
  const reasons = {
    'no_reliable_sources': '检索到的候选分数低于可靠阈值',
  };
  return reasons[reason] || (reason ? String(reason) : '');
});

// 各阶段耗时（过滤 0ms 的无关阶段）
const stages = computed(() => {
  const timings = props.trace?.timings || [];
  const stageLabels = {
    embedding: '向量化',
    milvus_search: '向量检索',
    child_select: '子句精排',
    rerank: 'Rerank 重排',
    parent_child: '父段落组装',
    llm: 'LLM 生成',
    document_check: '文档检查',
    total: '总耗时',
  };
  return timings
    .filter((t) => t.name !== 'total' && t.durationMs >= 0)
    .map((t) => ({ ...t, label: stageLabels[t.name] || t.name }));
});

const totalMs = computed(() => props.trace?.totalMs ?? null);

const queryRewrite = computed(() => {
  const qr = retrieval.value?.queryRewrite;
  if (!qr) return null;
  return typeof qr === 'string' ? qr : qr.rewritten || qr.query || JSON.stringify(qr);
});
</script>

<template>
  <div v-if="trace" class="mt-2 border-t border-slate-100 dark:border-gray-700 pt-2">
    <button
      class="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-gray-500 hover:text-wut-600 dark:hover:text-wut-400 transition-colors cursor-pointer"
      @click="expanded = !expanded"
    >
      <component :is="expanded ? ChevronDown : ChevronRight" :size="12" />
      <FileSearch :size="12" />
      <span>检索详情</span>
      <span class="px-1.5 py-0.5 rounded-full text-[10px] font-medium" :class="statusClass">{{ statusLabel }}</span>
      <span v-if="totalMs" class="text-[10px] text-slate-400 dark:text-gray-500 flex items-center gap-0.5">
        <Clock :size="10" />
        {{ totalMs }}ms
      </span>
    </button>

    <div v-if="expanded" class="mt-2 space-y-2 text-[11px] text-slate-500 dark:text-gray-400">
      <!-- 检索模式 -->
      <div class="flex items-center gap-1.5">
        <GitBranch :size="11" class="text-wut-500 dark:text-wut-400 shrink-0" />
        <span class="font-medium">{{ modeLabel }}</span>
        <span v-if="retrieval?.topK" class="text-slate-400 dark:text-gray-500">topK={{ retrieval.topK }}</span>
      </div>

      <!-- 查询改写 -->
      <div v-if="queryRewrite" class="flex items-start gap-1.5">
        <RefreshCw :size="11" class="text-violet-500 dark:text-violet-400 shrink-0 mt-0.5" />
        <span>已将问题改写为：<span class="text-slate-600 dark:text-gray-300">「{{ queryRewrite }}」</span></span>
      </div>

      <!-- 拒答原因 -->
      <div v-if="fallbackReason" class="flex items-start gap-1.5">
        <Search :size="11" class="text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
        <span>未命中原因：{{ fallbackReason }}</span>
      </div>

      <!-- 各阶段耗时 -->
      <div class="grid grid-cols-2 gap-1.5 pt-1">
        <div
          v-for="stage in stages"
          :key="stage.name"
          class="flex items-center justify-between px-2 py-1 rounded bg-slate-50 dark:bg-gray-800/60"
        >
          <span class="text-slate-500 dark:text-gray-400">{{ stage.label }}</span>
          <span class="font-mono font-medium" :class="stage.success ? 'text-slate-600 dark:text-gray-300' : 'text-red-500 dark:text-red-400'">
            {{ stage.durationMs }}ms
          </span>
        </div>
        <div v-if="totalMs" class="flex items-center justify-between px-2 py-1 rounded bg-wut-50 dark:bg-wut-900/20">
          <span class="text-wut-600 dark:text-wut-300">总耗时</span>
          <span class="font-mono font-medium text-wut-600 dark:text-wut-300">{{ totalMs }}ms</span>
        </div>
      </div>

      <!-- traceId -->
      <div v-if="trace.traceId" class="pt-0.5 text-[10px] text-slate-300 dark:text-gray-600 truncate select-all" :title="trace.traceId">
        traceId: {{ trace.traceId }}
      </div>
    </div>
  </div>
</template>
