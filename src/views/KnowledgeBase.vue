<script setup>
import { ref, computed, watch } from 'vue';
import { useKnowledgeBase } from '../composables/useKnowledgeBase.js';
import { useAuthStore } from '../stores/auth.store.js';
import { useToastStore } from '../stores/toast.store.js';
import { getOperationsDashboard, createKnowledgeTask } from '../api/operations.js';
import MarkdownRenderer from '../components/chat/MarkdownRenderer.vue';
import MobileMenuButton from '../components/layout/MobileMenuButton.vue';
import {
  Database,
  Plus,
  Trash2,
  RefreshCw,
  FileText,
  Search,
  X,
  FileUp,
  File,
  Eye,
  Shield
} from 'lucide-vue-next';

const {
  documents,
  stats,
  loading,
  uploading,
  showAddModal,
  showPreviewModal,
  showDeleteConfirm,
  deletingDoc,
  previewDoc,
  previewContent,
  previewLoading,
  addMode,
  searchQuery,
  selectedGroup,
  selectedSubCategory,
  showAdmin,
  newDoc,
  newDocGroup,
  newDocSubCategory,
  selectedFile,
  fileGroup,
  fileSubCategory,
  fileTitle,
  categoryGroups,
  availableSubCategories,
  fileSubCategories,
  filterSubCategories,
  filteredDocuments,
  refresh,
  openAddModal,
  previewContentRef,
  highlightText,
  openPreview,
  submitDocument,
  handleFileSelect,
  submitFileUpload,
  openDeleteConfirm,
  confirmDelete,
  closeDeleteConfirm,
  getCategoryLabel,
  getGroupLabel,
  getVectorStatusLabel,
  getVectorStatusClasses,
  formatDate,
  formatSize,
  formatFileSize,
  supportedFileTypes,
} = useKnowledgeBase();

// ===== 知识库缺口看板（管理员可见）：复用线上质量审计，回答"该补什么资料" =====
const authStore = useAuthStore();
const toast = useToastStore();
const gapSummary = ref(null);
const gapLoading = ref(false);
const gapTaskBusy = ref('');
// 管理员登录即可见（缺口看板只读 + 建任务）；"管理"模式才解锁增删改
const gapVisible = computed(() => showAdmin.value || authStore.isAdmin === true);

const loadGapSummary = async () => {
  gapLoading.value = true;
  try {
    const res = await getOperationsDashboard();
    gapSummary.value = res?.data?.riskAudit || null;
  } catch {
    gapSummary.value = null;
  } finally {
    gapLoading.value = false;
  }
};

watch(gapVisible, (visible) => {
  if (visible && !gapSummary.value) loadGapSummary();
}, { immediate: true });

// 知识总量（客户端聚合，仅展示用）
const kbTotalChars = computed(() =>
  documents.value.reduce((sum, d) => sum + (Number(d.contentLength) || 0), 0)
);

const createGapTask = async (audit) => {
  if (gapTaskBusy.value) return;
  gapTaskBusy.value = audit.id;
  try {
    const res = await createKnowledgeTask({
      auditId: audit.id,
      title: `补充「${String(audit.question || '').slice(0, 24)}」相关资料`,
      description: `用户询问「${audit.question}」时知识库存在缺口（主题：${audit.topic?.label || '未知'}），建议补充权威来源文档。`,
    });
    if (!res?.success) throw new Error(res?.error || '创建失败');
    toast.success('已创建资料补充任务，可在运营看板跟进');
    audit._taskCreated = true;
  } catch (error) {
    toast.error(error.message || '创建补充任务失败');
  } finally {
    gapTaskBusy.value = '';
  }
};
</script>

<template>
  <div class="h-full flex flex-col p-4 md:p-6">
    <!-- 头部 -->
    <div class="flex items-center justify-between mb-5">
      <div class="flex items-center gap-3">
        <MobileMenuButton />
        <div class="w-10 h-10 rounded-xl bg-wut-600 flex items-center justify-center text-white shadow-lg shadow-wut-500/20">
          <Database :size="20" />
        </div>
        <div>
          <h1 class="text-lg font-bold text-slate-800 dark:text-white">校园知识库</h1>
          <p class="text-xs text-slate-500 dark:text-gray-400">武汉理工大学知识文档中心</p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button
          @click="refresh"
          :disabled="loading"
          class="h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-xs border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw :size="14" :class="{ 'animate-spin': loading }" />
          <span>刷新</span>
        </button>

        <!-- 管理员模式开关 -->
        <button
          @click="showAdmin = !showAdmin"
          class="h-8 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-xs border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 transition-colors"
          :class="showAdmin
            ? 'text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20'
            : 'text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700'"
          :title="showAdmin ? '退出管理' : '管理知识库'"
        >
          <Shield :size="14" />
          <span class="hidden sm:inline">{{ showAdmin ? '退出管理' : '管理' }}</span>
        </button>

        <!-- 管理按钮（仅在管理员模式下显示） -->
        <button
          v-if="showAdmin"
          @click="openAddModal"
          class="h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-xs bg-violet-600 text-white hover:bg-violet-700 transition-colors shadow-sm"
        >
          <Plus :size="14" />
          <span>添加文档</span>
        </button>
      </div>
    </div>

    <!-- 管理员模式提示条 -->
    <div
      v-if="showAdmin"
      class="mb-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 flex items-center justify-between"
    >
      <div class="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
        <Shield :size="14" />
        <span>管理员模式 — 可添加、删除知识库文档</span>
      </div>
      <button
        @click="showAdmin = false"
        class="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 underline"
      >退出管理</button>
    </div>

    <!-- 知识库缺口看板（管理员可见）：线上提问主题分布与资料缺口 -->
    <div
      v-if="gapVisible"
      class="mb-5 rounded-2xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4"
    >
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <Shield :size="15" class="text-wut-600 dark:text-wut-400" />
          <h2 class="text-sm font-bold text-slate-800 dark:text-white">知识库缺口看板</h2>
          <span class="text-[10px] text-slate-400 dark:text-gray-500">基于线上回答质量审计</span>
        </div>
        <button
          @click="loadGapSummary"
          :disabled="gapLoading"
          class="h-7 px-2.5 rounded-lg text-xs text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {{ gapLoading ? '加载中...' : '刷新' }}
        </button>
      </div>

      <div v-if="!gapSummary" class="py-6 text-center text-xs text-slate-400 dark:text-gray-500">
        {{ gapLoading ? '正在加载审计数据...' : '暂无审计数据：用户提问后自动聚合' }}
      </div>
      <template v-else>
        <div class="grid grid-cols-3 gap-3 mb-3">
          <div class="rounded-xl bg-slate-50 dark:bg-gray-800/60 p-3 text-center">
            <div class="text-xl font-black text-slate-800 dark:text-white">{{ gapSummary.totalQuestions }}</div>
            <div class="text-[10px] text-slate-500 dark:text-gray-400">累计审计提问</div>
          </div>
          <div class="rounded-xl bg-amber-50 dark:bg-amber-900/20 p-3 text-center">
            <div class="text-xl font-black text-amber-600 dark:text-amber-300">{{ gapSummary.knowledgeGapCount }}</div>
            <div class="text-[10px] text-amber-700/70 dark:text-amber-300/60">知识缺口</div>
          </div>
          <div class="rounded-xl bg-rose-50 dark:bg-rose-900/20 p-3 text-center">
            <div class="text-xl font-black text-rose-600 dark:text-rose-300">{{ gapSummary.highRiskCount }}</div>
            <div class="text-[10px] text-rose-700/70 dark:text-rose-300/60">高风险回答</div>
          </div>
        </div>

        <div v-if="gapSummary.topTopics?.length" class="flex flex-wrap gap-1.5 mb-3">
          <span
            v-for="topic in gapSummary.topTopics.slice(0, 5)"
            :key="topic.key"
            class="rounded-full bg-slate-100 dark:bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-gray-300"
          >
            {{ topic.label }} · {{ topic.count }} 次
            <span v-if="topic.gaps" class="text-amber-600 dark:text-amber-400">（缺 {{ topic.gaps }}）</span>
          </span>
        </div>

        <div v-if="gapSummary.highRisk?.length" class="space-y-2">
          <div
            v-for="audit in gapSummary.highRisk.slice(0, 4)"
            :key="audit.id"
            class="flex items-start justify-between gap-3 rounded-xl border border-slate-100 dark:border-gray-800 bg-slate-50/60 dark:bg-gray-800/40 px-3 py-2"
          >
            <div class="min-w-0">
              <p class="truncate text-xs font-medium text-slate-700 dark:text-gray-200">{{ audit.question }}</p>
              <p class="mt-0.5 text-[10px] text-slate-400 dark:text-gray-500">
                {{ audit.topic?.label || '综合咨询' }}
                <span v-if="audit.knowledgeGap" class="text-amber-600 dark:text-amber-400">· 资料缺口</span>
              </p>
            </div>
            <button
              v-if="audit.knowledgeGap && !audit._taskCreated"
              @click="createGapTask(audit)"
              :disabled="gapTaskBusy === audit.id"
              class="shrink-0 rounded-lg border border-wut-200 dark:border-wut-800 px-2.5 py-1.5 text-[11px] font-bold text-wut-600 dark:text-wut-300 hover:bg-wut-50 dark:hover:bg-wut-900/30 disabled:opacity-50 transition-colors"
            >
              {{ gapTaskBusy === audit.id ? '创建中...' : '创建补充任务' }}
            </button>
            <span v-else-if="audit._taskCreated" class="shrink-0 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">已建任务</span>
          </div>
        </div>
      </template>
    </div>

    <!-- 统计卡片 -->
    <div v-if="stats" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
      <div class="rounded-xl border border-slate-200 dark:border-gray-700 bg-wut-50/60 dark:bg-wut-900/20 p-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-wut-100 dark:bg-wut-900/40 flex items-center justify-center text-wut-600 dark:text-wut-400">
            <FileText :size="16" />
          </div>
          <div>
            <p class="text-xl font-bold text-slate-800 dark:text-white">{{ stats.documents?.count || 0 }}</p>
            <p class="text-[10px] text-slate-500 dark:text-gray-400">文档总数</p>
          </div>
        </div>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-gray-700 bg-wut-50/60 dark:bg-wut-900/20 p-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <Database :size="16" />
          </div>
          <div>
            <p class="text-xl font-bold text-slate-800 dark:text-white">{{ new Set(documents.map(d => d.category)).size || 0 }} 类</p>
            <p class="text-[10px] text-slate-500 dark:text-gray-400">覆盖分类</p>
          </div>
        </div>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-gray-700 bg-wut-50/60 dark:bg-wut-900/20 p-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-cyan-100 dark:bg-cyan-900/40 flex items-center justify-center text-cyan-600 dark:text-cyan-400">
            <Database :size="16" />
          </div>
          <div>
            <p class="text-xl font-bold text-slate-800 dark:text-white">{{ stats.vectors?.count ?? '—' }}</p>
            <p class="text-[10px] text-slate-500 dark:text-gray-400">向量条数</p>
          </div>
        </div>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-gray-700 bg-wut-50/60 dark:bg-wut-900/20 p-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <FileText :size="16" />
          </div>
          <div>
            <p class="text-xl font-bold text-slate-800 dark:text-white">{{ formatSize(kbTotalChars) }}</p>
            <p class="text-[10px] text-slate-500 dark:text-gray-400">知识总量</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 向量库状态诚实提示：文档存在但向量为空时，检索实际不可用 -->
    <div
      v-if="stats && (stats.vectors?.count ?? 0) === 0 && (stats.documents?.count || 0) > 0"
      class="mb-4 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 flex items-center justify-between"
    >
      <span class="text-xs text-amber-700 dark:text-amber-300">向量库当前为空，检索暂时不可用（文档元数据仍在）。可在管理模式下重索引重建。</span>
    </div>

    <!-- 搜索和过滤 -->
    <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 mb-4">
      <div class="relative flex-1">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" :size="14" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索文档..."
          class="w-full h-9 pl-8 pr-8 text-sm rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
        />
        <button
          v-if="searchQuery"
          @click="searchQuery = ''"
          class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        >
          <X :size="14" />
        </button>
      </div>
      <select
        v-model="selectedGroup"
        class="w-36 h-9 px-3 text-sm rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
        @change="selectedSubCategory = ''"
      >
        <option value="">全部分类</option>
        <option v-for="g in categoryGroups" :key="g.value" :value="g.value">{{ g.label }}</option>
      </select>
      <select
        v-model="selectedSubCategory"
        :disabled="!selectedGroup"
        class="w-36 h-9 px-3 text-sm rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50"
      >
        <option value="">全部 {{ selectedGroup ? categoryGroups.find(g => g.value === selectedGroup)?.label : '' }}</option>
        <option v-for="sub in filterSubCategories" :key="sub.value" :value="sub.value">{{ sub.label }}</option>
      </select>
    </div>

    <!-- 文档列表 -->
    <div class="flex-1 min-h-0 overflow-y-scroll rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-gray-600">
      <div v-if="loading" class="flex items-center justify-center h-48 text-slate-500 dark:text-gray-400">
        <RefreshCw class="animate-spin mr-2" :size="16" />
        加载中...
      </div>

      <div v-else-if="filteredDocuments.length === 0" class="flex flex-col items-center justify-center h-48 text-slate-500 dark:text-gray-400">
        <Database :size="40" class="mb-3 opacity-30" />
        <p class="text-sm">知识库暂无内容</p>
        <p class="text-xs mt-1">知识库文档由管理员统一维护</p>
      </div>

      <div v-else class="divide-y divide-slate-100 dark:divide-gray-700">
        <div
          v-for="doc in filteredDocuments"
          :key="doc.id"
          class="group px-4 py-3 hover:bg-slate-50 dark:hover:bg-gray-700/50 transition-colors"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-start gap-3 min-w-0 flex-1">
              <div class="w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-600 dark:text-violet-400 shrink-0 mt-0.5">
                <FileText :size="16" />
              </div>
              <div class="min-w-0 flex-1">
                <h3 class="text-sm font-medium text-slate-800 dark:text-gray-100 truncate" v-html="highlightText(doc.title)"></h3>
                <div class="flex items-center gap-2 mt-1 flex-wrap">
                  <span
                    v-if="getGroupLabel(doc.category) !== getCategoryLabel(doc.category)"
                    class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-gray-700 text-slate-600 dark:text-gray-300"
                  >
                    <span v-html="highlightText(getGroupLabel(doc.category))"></span>
                  </span>
                  <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-wut-100 dark:bg-wut-900/30 text-wut-700 dark:text-wut-300">
                    <span v-html="highlightText(getCategoryLabel(doc.category))"></span>
                  </span>
                  <span
                    class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
                    :class="getVectorStatusClasses(doc.vectorStatus)"
                    :title="doc.vectorMessage || getVectorStatusLabel(doc.vectorStatus)"
                  >
                    {{ getVectorStatusLabel(doc.vectorStatus) }}
                  </span>
                  <span class="text-[10px] text-slate-400 dark:text-gray-500">{{ formatSize(doc.contentLength) }}</span>
                  <span class="text-[10px] text-slate-400 dark:text-gray-500">{{ formatDate(doc.createdAt) }}</span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button
                @click="openPreview(doc)"
                class="h-7 px-2 rounded-md inline-flex items-center gap-1 text-xs text-slate-500 dark:text-gray-400 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
              >
                <Eye :size="12" />
                <span>预览</span>
              </button>
              <button
                v-if="showAdmin"
                @click="openDeleteConfirm(doc)"
                class="h-7 px-2 rounded-md inline-flex items-center gap-1 text-xs text-slate-500 dark:text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
              >
                <Trash2 :size="12" />
                <span>删除</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 预览模态框 -->
    <div
      v-if="showPreviewModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      @click.self="showPreviewModal = false"
    >
      <div class="w-full max-w-2xl mx-4 max-h-[80vh] rounded-2xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl flex flex-col">
        <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-gray-700 shrink-0">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-600 dark:text-violet-400">
              <FileText :size="16" />
            </div>
            <div>
              <h3 class="text-sm font-bold text-slate-800 dark:text-white">{{ previewDoc?.title }}</h3>
              <p class="text-[10px] text-slate-500 dark:text-gray-400">{{ getGroupLabel(previewDoc?.category) === getCategoryLabel(previewDoc?.category) ? getCategoryLabel(previewDoc?.category) : `${getGroupLabel(previewDoc?.category)} / ${getCategoryLabel(previewDoc?.category)}` }} · {{ formatSize(previewDoc?.contentLength) }}</p>
            </div>
          </div>
          <button
            @click="showPreviewModal = false"
            class="w-8 h-8 rounded-lg inline-flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X :size="16" />
          </button>
        </div>
        <div ref="previewContentRef" class="flex-1 overflow-y-auto p-5">
          <div v-if="previewLoading" class="flex items-center justify-center h-32 text-slate-500 dark:text-gray-400">
            <RefreshCw class="animate-spin mr-2" :size="16" />
            加载中...
          </div>
          <div v-else class="text-sm text-slate-700 dark:text-gray-300 leading-relaxed">
            <MarkdownRenderer :content="previewContent" :highlight="searchQuery" />
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <div
      v-if="showDeleteConfirm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      @click.self="closeDeleteConfirm"
    >
      <div class="w-full max-w-sm mx-4 rounded-2xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl p-4">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center text-rose-600 dark:text-rose-400">
            <Trash2 :size="20" />
          </div>
          <div>
            <h3 class="text-sm font-bold text-slate-800 dark:text-white">删除文档</h3>
            <p class="text-xs text-slate-500 dark:text-gray-400 truncate max-w-[200px]">{{ deletingDoc?.title }}</p>
          </div>
        </div>
        <p class="text-xs text-slate-600 dark:text-gray-300 mb-4">
          确定要删除此文档吗？删除后文档内容将无法恢复。
        </p>
        <div class="flex justify-end gap-2">
          <button
            @click="closeDeleteConfirm"
            class="h-8 px-3 rounded-lg text-xs text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            取消
          </button>
          <button
            @click="confirmDelete"
            class="h-8 px-3 rounded-lg text-xs bg-rose-500 text-white hover:bg-rose-600 transition-colors"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>

    <!-- 添加文档模态框 -->
    <div
      v-if="showAddModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      @click.self="showAddModal = false"
    >
      <div class="w-full max-w-xl mx-4 rounded-2xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl">
        <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-gray-700">
          <h3 class="text-base font-bold text-slate-800 dark:text-white">添加文档</h3>
          <button
            @click="showAddModal = false"
            class="w-8 h-8 rounded-lg inline-flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X :size="16" />
          </button>
        </div>

        <!-- 模式切换 -->
        <div class="px-5 pt-4">
          <div class="flex gap-1 p-1 rounded-lg bg-slate-100 dark:bg-gray-800">
            <button
              @click="addMode = 'text'"
              :class="[
                'flex-1 h-8 rounded-md text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
                addMode === 'text'
                  ? 'bg-white dark:bg-gray-700 text-slate-800 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200'
              ]"
            >
              <FileText :size="14" />
              <span>手动输入</span>
            </button>
            <button
              @click="addMode = 'file'"
              :class="[
                'flex-1 h-8 rounded-md text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
                addMode === 'file'
                  ? 'bg-white dark:bg-gray-700 text-slate-800 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200'
              ]"
            >
              <FileUp :size="14" />
              <span>上传文件</span>
            </button>
          </div>
        </div>

        <!-- 手动输入模式 -->
        <div v-if="addMode === 'text'" class="p-5 space-y-3">
          <div>
            <label class="block text-xs font-medium text-slate-700 dark:text-gray-300 mb-1">文档标题</label>
            <input
              v-model="newDoc.title"
              type="text"
              placeholder="例如：数据结构期末复习笔记"
              class="w-full h-9 px-3 text-sm rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
          </div>

          <div>
            <label class="block text-xs font-medium text-slate-700 dark:text-gray-300 mb-1">一级分类</label>
            <select
              v-model="newDocGroup"
              class="w-full h-9 px-3 text-sm rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              @change="newDocSubCategory = ''"
            >
              <option v-for="g in categoryGroups" :key="g.value" :value="g.value">{{ g.label }}</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-medium text-slate-700 dark:text-gray-300 mb-1">二级分类</label>
            <select
              v-model="newDocSubCategory"
              class="w-full h-9 px-3 text-sm rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            >
              <option value="" disabled>请选择二级分类</option>
              <option v-for="sub in availableSubCategories" :key="sub.value" :value="sub.value">{{ sub.label }}</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-medium text-slate-700 dark:text-gray-300 mb-1">文档内容</label>
            <textarea
              v-model="newDoc.content"
              rows="6"
              placeholder="输入文档内容，支持多段落。系统会自动进行切片处理..."
              class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 resize-none"
            ></textarea>
            <p class="mt-1 text-[10px] text-slate-500 dark:text-gray-400">
              当前 {{ newDoc.content.length }} 字符，预计 {{ Math.ceil(newDoc.content.length / 500) || 0 }} 个片段
            </p>
          </div>
        </div>

        <!-- 文件上传模式 -->
        <div v-else class="p-5 space-y-3">
          <div>
            <label class="block text-xs font-medium text-slate-700 dark:text-gray-300 mb-1">选择文件</label>
            <div
              class="relative border-2 border-dashed border-slate-300 dark:border-gray-600 rounded-lg p-5 text-center hover:border-violet-400 dark:hover:border-violet-500 transition-colors cursor-pointer"
              @click="$refs.fileInput.click()"
            >
              <input
                ref="fileInput"
                type="file"
                :accept="supportedFileTypes"
                class="hidden"
                @change="handleFileSelect"
              />
              <div v-if="!selectedFile">
                <FileUp :size="28" class="mx-auto text-slate-400 mb-2" />
                <p class="text-xs text-slate-600 dark:text-gray-300">点击或拖拽文件到此处</p>
                <p class="text-[10px] text-slate-400 mt-1">支持 {{ supportedFileTypes }} 格式，最大 10MB</p>
              </div>
              <div v-else class="flex items-center justify-center gap-2">
                <File :size="20" class="text-violet-500" />
                <div class="text-left">
                  <p class="text-xs font-medium text-slate-800 dark:text-white">{{ selectedFile.name }}</p>
                  <p class="text-[10px] text-slate-500">{{ formatFileSize(selectedFile.size) }}</p>
                </div>
                <button
                  @click.stop="selectedFile = null"
                  class="ml-2 w-5 h-5 rounded-full inline-flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                >
                  <X :size="12" />
                </button>
              </div>
            </div>
          </div>

          <div>
            <label class="block text-xs font-medium text-slate-700 dark:text-gray-300 mb-1">文档标题（可选）</label>
            <input
              v-model="fileTitle"
              type="text"
              placeholder="留空则使用文件名"
              class="w-full h-9 px-3 text-sm rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
          </div>

          <div>
            <label class="block text-xs font-medium text-slate-700 dark:text-gray-300 mb-1">一级分类</label>
            <select
              v-model="fileGroup"
              class="w-full h-9 px-3 text-sm rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              @change="fileSubCategory = ''"
            >
              <option v-for="g in categoryGroups" :key="g.value" :value="g.value">{{ g.label }}</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-medium text-slate-700 dark:text-gray-300 mb-1">二级分类</label>
            <select
              v-model="fileSubCategory"
              class="w-full h-9 px-3 text-sm rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            >
              <option value="" disabled>请选择二级分类</option>
              <option v-for="sub in fileSubCategories" :key="sub.value" :value="sub.value">{{ sub.label }}</option>
            </select>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 dark:border-gray-700">
          <button
            @click="showAddModal = false"
            class="h-8 px-3 rounded-lg text-xs border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors"
          >
            取消
          </button>
          <button
            v-if="addMode === 'text'"
            @click="submitDocument"
            class="h-8 px-3 rounded-lg text-xs bg-violet-600 text-white hover:bg-violet-700 transition-colors"
          >
            添加文档
          </button>
          <button
            v-else
            @click="submitFileUpload"
            :disabled="uploading || !selectedFile"
            class="h-8 px-3 rounded-lg text-xs bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-50"
          >
            <span v-if="uploading" class="inline-flex items-center gap-1.5">
              <RefreshCw class="animate-spin" :size="12" />
              上传中...
            </span>
            <span v-else>上传文件</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 搜索词高亮（v-html 注入的 mark 元素） */
:deep(.search-hit) {
  background-color: #fef08a;
  color: #92400e;
  border-radius: 3px;
  padding: 0 1px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
:root.dark :deep(.search-hit) {
  background-color: #854d0e;
  color: #fef9c3;
}
</style>
