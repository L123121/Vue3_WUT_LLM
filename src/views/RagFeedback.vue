<script setup>
import { computed, onMounted, ref } from 'vue';
import { Download, Frown, MessageCircle, RefreshCw, Search, ThumbsDown, ThumbsUp } from 'lucide-vue-next';
import { getRagFeedback } from '../api/rag.js';
import { useToastStore } from '../stores/toast.store.js';
import MobileMenuButton from '../components/layout/MobileMenuButton.vue';

const toast = useToastStore();
const feedbackItems = ref([]);
const summary = ref({ total: 0, like: 0, dislike: 0 });
const pagination = ref({ page: 1, limit: 20, total: 0, totalPages: 1 });
const isLoading = ref(false);
const ratingFilter = ref('');
const keyword = ref('');
const expandedId = ref('');

const satisfactionRate = computed(() => {
  if (!summary.value.total) return '0%';
  return `${Math.round((summary.value.like / summary.value.total) * 100)}%`;
});

const ratingOptions = [
  { value: '', label: '全部反馈' },
  { value: 'like', label: '只看点赞' },
  { value: 'dislike', label: '只看点踩' },
];

const formatTime = (value) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
};

const getSourceTitle = (item) => {
  const source = item.sources?.[0];
  if (!source) return '无来源记录';
  return source.title || source.category || '未命名来源';
};

const fetchFeedback = async (page = 1) => {
  isLoading.value = true;
  try {
    const res = await getRagFeedback({
      page,
      limit: pagination.value.limit,
      rating: ratingFilter.value,
      q: keyword.value.trim(),
    });
    feedbackItems.value = res.data?.items || [];
    summary.value = res.data?.summary || { total: 0, like: 0, dislike: 0 };
    pagination.value = res.data?.pagination || { page, limit: pagination.value.limit, total: 0, totalPages: 1 };
  } catch (error) {
    toast.error(error.message || '反馈数据加载失败');
  } finally {
    isLoading.value = false;
  }
};

const resetFilters = () => {
  ratingFilter.value = '';
  keyword.value = '';
  fetchFeedback(1);
};

const escapeCsv = (value) => {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  return `"${text.replace(/"/g, '""')}"`;
};

const exportCsv = () => {
  if (feedbackItems.value.length === 0) {
    toast.warning('当前没有可导出的反馈');
    return;
  }

  const headers = ['评价', '用户', '问题', '回答', '来源', 'TraceId', '时间'];
  const rows = feedbackItems.value.map((item) => [
    item.rating === 'like' ? '点赞' : '点踩',
    item.userId,
    item.question,
    item.answer,
    getSourceTitle(item),
    item.traceId,
    formatTime(item.createdAt),
  ]);
  const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `rag-feedback-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  toast.success('反馈已导出 CSV');
};

onMounted(() => fetchFeedback());
</script>

<template>
  <div class="h-full overflow-y-auto bg-slate-50 dark:bg-gray-950">
    <div class="mx-auto max-w-7xl px-4 py-6 md:px-8">
      <div class="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div class="absolute inset-x-0 top-0 h-1 bg-wut-600"></div>
        <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div class="flex items-start gap-3">
            <MobileMenuButton class="mt-1" />
            <div>
              <p class="text-xs font-black uppercase tracking-[0.24em] text-wut-600 dark:text-cyan-300">RAG Feedback</p>
              <h1 class="mt-2 text-2xl font-black text-slate-900 dark:text-white">用户反馈收集台</h1>
              <p class="mt-2 max-w-2xl text-sm text-slate-500 dark:text-gray-400">聚合用户对 RAG 回答的点赞和点踩，优先定位需要补资料、改检索或修回答的问题。</p>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              @click="fetchFeedback(pagination.page)"
              :disabled="isLoading"
              class="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 transition hover:border-wut-200 hover:bg-wut-50 hover:text-wut-700 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:border-wut-800 dark:hover:bg-wut-900/20"
            >
              <RefreshCw :size="16" :class="{ 'animate-spin': isLoading }" />
              刷新
            </button>
            <button
              @click="exportCsv"
              class="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-slate-900/10 transition hover:-translate-y-0.5 hover:bg-wut-700 dark:bg-white dark:text-slate-900 dark:hover:bg-cyan-100"
            >
              <Download :size="16" />
              导出 CSV
            </button>
          </div>
        </div>
      </div>

      <div class="mt-5 grid gap-4 md:grid-cols-4">
        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div class="flex items-center justify-between">
            <span class="text-sm font-bold text-slate-500 dark:text-gray-400">总反馈</span>
            <MessageCircle :size="18" class="text-wut-500" />
          </div>
          <div class="mt-3 text-3xl font-black text-slate-900 dark:text-white">{{ summary.total }}</div>
        </div>
        <div class="rounded-2xl border border-emerald-100 bg-emerald-50 p-5 shadow-sm dark:border-emerald-900/50 dark:bg-emerald-900/20">
          <div class="flex items-center justify-between">
            <span class="text-sm font-bold text-emerald-700 dark:text-emerald-300">点赞</span>
            <ThumbsUp :size="18" class="text-emerald-600" />
          </div>
          <div class="mt-3 text-3xl font-black text-emerald-700 dark:text-emerald-300">{{ summary.like }}</div>
        </div>
        <div class="rounded-2xl border border-rose-100 bg-rose-50 p-5 shadow-sm dark:border-rose-900/50 dark:bg-rose-900/20">
          <div class="flex items-center justify-between">
            <span class="text-sm font-bold text-rose-700 dark:text-rose-300">点踩</span>
            <ThumbsDown :size="18" class="text-rose-600" />
          </div>
          <div class="mt-3 text-3xl font-black text-rose-700 dark:text-rose-300">{{ summary.dislike }}</div>
        </div>
        <div class="rounded-2xl border border-cyan-100 bg-cyan-50 p-5 shadow-sm dark:border-cyan-900/50 dark:bg-cyan-900/20">
          <div class="flex items-center justify-between">
            <span class="text-sm font-bold text-cyan-700 dark:text-cyan-300">满意率</span>
            <span class="h-2.5 w-2.5 rounded-full bg-cyan-500 shadow-[0_0_16px_rgba(6,182,212,0.8)]"></span>
          </div>
          <div class="mt-3 text-3xl font-black text-cyan-700 dark:text-cyan-300">{{ satisfactionRate }}</div>
        </div>
      </div>

      <div class="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div class="flex flex-col gap-3 md:flex-row md:items-center">
          <div class="relative flex-1">
            <Search :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              v-model="keyword"
              @keyup.enter="fetchFeedback(1)"
              placeholder="搜索问题、回答、来源、用户或 TraceId"
              class="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-wut-300 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-wut-700 dark:focus:ring-blue-900/30"
            />
          </div>
          <select
            v-model="ratingFilter"
            class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-600 outline-none transition focus:border-wut-300 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            <option v-for="option in ratingOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
          <button @click="fetchFeedback(1)" class="rounded-xl bg-wut-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-wut-500/20 transition hover:bg-wut-700">查询</button>
          <button @click="resetFilters" class="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-100 dark:text-gray-400 dark:hover:bg-gray-800">重置</button>
        </div>
      </div>

      <div class="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div v-if="isLoading" class="flex items-center justify-center py-20 text-sm font-bold text-slate-500 dark:text-gray-400">
          <RefreshCw :size="18" class="mr-2 animate-spin" />
          正在加载反馈...
        </div>
        <div v-else-if="feedbackItems.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
          <Frown :size="48" class="text-slate-300 dark:text-gray-700" />
          <p class="mt-4 text-sm font-bold text-slate-500 dark:text-gray-400">暂无反馈数据</p>
          <p class="mt-1 text-xs text-slate-400 dark:text-gray-500">用户在 RAG 回答后点击点赞/点踩后会出现在这里。</p>
        </div>
        <div v-else class="divide-y divide-slate-100 dark:divide-gray-800">
          <article v-for="item in feedbackItems" :key="`${item.userId}:${item.id}`" class="p-5 transition hover:bg-slate-50 dark:hover:bg-gray-800/40">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div class="min-w-0 flex-1">
                <div class="mb-2 flex flex-wrap items-center gap-2">
                  <span
                    :class="[
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black',
                      item.rating === 'like'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                        : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                    ]"
                  >
                    <ThumbsUp v-if="item.rating === 'like'" :size="13" />
                    <ThumbsDown v-else :size="13" />
                    {{ item.rating === 'like' ? '点赞' : '点踩' }}
                  </span>
                  <span class="text-xs font-bold text-slate-400 dark:text-gray-500">{{ formatTime(item.createdAt) }}</span>
                  <span class="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500 dark:bg-gray-800 dark:text-gray-400">用户 {{ item.userId || '-' }}</span>
                </div>
                <h3 class="line-clamp-2 text-base font-black text-slate-900 dark:text-white">{{ item.question || '（无问题文本）' }}</h3>
                <p class="mt-2 line-clamp-3 text-sm leading-6 text-slate-600 dark:text-gray-300">{{ item.answer || '（无回答文本）' }}</p>
                <div class="mt-3 flex flex-wrap gap-2 text-xs text-slate-400 dark:text-gray-500">
                  <span class="rounded-lg bg-slate-100 px-2 py-1 dark:bg-gray-800">来源：{{ getSourceTitle(item) }}</span>
                  <span v-if="item.traceId" class="rounded-lg bg-slate-100 px-2 py-1 dark:bg-gray-800">Trace：{{ item.traceId }}</span>
                </div>
              </div>
              <button
                @click="expandedId = expandedId === item.id ? '' : item.id"
                class="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500 transition hover:border-wut-200 hover:bg-wut-50 hover:text-wut-700 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-wut-900/20"
              >
                {{ expandedId === item.id ? '收起详情' : '查看详情' }}
              </button>
            </div>
            <div v-if="expandedId === item.id" class="mt-4 grid gap-3 lg:grid-cols-2">
              <div class="rounded-xl bg-slate-50 p-4 dark:bg-gray-950/60">
                <div class="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Question</div>
                <p class="whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-gray-300">{{ item.question || '（空）' }}</p>
              </div>
              <div class="rounded-xl bg-slate-50 p-4 dark:bg-gray-950/60">
                <div class="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Answer</div>
                <p class="whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-gray-300">{{ item.answer || '（空）' }}</p>
              </div>
            </div>
          </article>
        </div>
      </div>

      <div class="mt-5 flex items-center justify-between text-sm text-slate-500 dark:text-gray-400">
        <span>共 {{ pagination.total }} 条，第 {{ pagination.page }} / {{ pagination.totalPages }} 页</span>
        <div class="flex gap-2">
          <button
            @click="fetchFeedback(pagination.page - 1)"
            :disabled="pagination.page <= 1 || isLoading"
            class="rounded-xl border border-slate-200 px-4 py-2 font-bold transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            上一页
          </button>
          <button
            @click="fetchFeedback(pagination.page + 1)"
            :disabled="pagination.page >= pagination.totalPages || isLoading"
            class="rounded-xl border border-slate-200 px-4 py-2 font-bold transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  </div>
</template>