<script setup>
import { ref, computed, onMounted } from 'vue';
import { getDocuments, addDocument, deleteDocument, getStats, uploadFile, getDocumentContent } from '../api/rag.js';
import { useToastStore } from '../stores/toast.store.js';
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
  Eye
} from 'lucide-vue-next';

const toastStore = useToastStore();

// 状态
const documents = ref([]);
const stats = ref(null);
const loading = ref(false);
const uploading = ref(false);
const showAddModal = ref(false);
const showPreviewModal = ref(false);
const showDeleteConfirm = ref(false);
const deletingDoc = ref(null);
const previewDoc = ref(null);
const previewContent = ref('');
const previewLoading = ref(false);
const addMode = ref('text'); // 'text' 或 'file'
const searchQuery = ref('');
const selectedCategory = ref('');

// 新文档表单
const newDoc = ref({
  title: '',
  content: '',
  category: 'general'
});

// 文件上传
const fileInputRef = ref(null);
const selectedFile = ref(null);
const fileCategory = ref('general');
const fileTitle = ref('');

// 分类选项
const categories = [
  { value: 'general', label: '通用' },
  { value: 'school_info', label: '学校概况' },
  { value: 'cs_info', label: '计算机学院' },
  { value: 'library', label: '图书馆' },
  { value: 'academic', label: '教务相关' },
  { value: 'lab', label: '实验室' },
  { value: 'dormitory', label: '宿舍' },
  { value: 'safety', label: '安全规范' }
];

// 过滤后的文档
const filteredDocuments = computed(() => {
  let result = documents.value;

  if (selectedCategory.value) {
    result = result.filter(doc => doc.category === selectedCategory.value);
  }

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(doc =>
      doc.title.toLowerCase().includes(query) ||
      doc.category.toLowerCase().includes(query)
    );
  }

  return result;
});

// 加载文档列表
const loadDocuments = async () => {
  loading.value = true;
  try {
    const result = await getDocuments({ limit: 100 });
    if (result.success) {
      documents.value = result.data.documents || [];
    }
  } catch (error) {
    console.error('加载文档失败:', error);
    toastStore.error('加载文档列表失败');
  } finally {
    loading.value = false;
  }
};

// 加载统计信息
const loadStats = async () => {
  try {
    const result = await getStats();
    if (result.success) {
      stats.value = result.data;
    }
  } catch (error) {
    console.error('加载统计失败:', error);
  }
};

// 刷新数据
const refresh = async () => {
  await Promise.all([loadDocuments(), loadStats()]);
};

// 打开添加模态框
const openAddModal = () => {
  addMode.value = 'text';
  newDoc.value = { title: '', content: '', category: 'general' };
  selectedFile.value = null;
  fileTitle.value = '';
  fileCategory.value = 'general';
  showAddModal.value = true;
};

// 预览文档
const openPreview = async (doc) => {
  previewDoc.value = doc;
  showPreviewModal.value = true;
  previewLoading.value = true;
  previewContent.value = '';

  try {
    const result = await getDocumentContent(doc.id);
    if (result.success) {
      previewContent.value = result.data.content || '无内容';
    } else {
      previewContent.value = '加载失败';
    }
  } catch (error) {
    console.error('加载文档内容失败:', error);
    previewContent.value = '加载失败';
  } finally {
    previewLoading.value = false;
  }
};

// 提交新文档
const submitDocument = async () => {
  if (!newDoc.value.title.trim()) {
    toastStore.error('请输入文档标题');
    return;
  }
  if (!newDoc.value.content.trim()) {
    toastStore.error('请输入文档内容');
    return;
  }

  try {
    const result = await addDocument(newDoc.value);
    if (result.success) {
      toastStore.success('文档添加成功');
      showAddModal.value = false;
      await refresh();
    } else {
      toastStore.error(result.message || '添加失败');
    }
  } catch (error) {
    console.error('添加文档失败:', error);
    toastStore.error('添加文档失败');
  }
};

// 选择文件
const handleFileSelect = (event) => {
  const file = event.target.files[0];
  if (file) {
    selectedFile.value = file;
    // 自动填充标题（文件名）
    if (!fileTitle.value) {
      fileTitle.value = file.name.replace(/\.[^/.]+$/, '');
    }
  }
};

// 上传文件
const submitFileUpload = async () => {
  if (!selectedFile.value) {
    toastStore.error('请选择文件');
    return;
  }

  uploading.value = true;
  try {
    const result = await uploadFile(selectedFile.value, fileCategory.value, fileTitle.value);
    if (result.success) {
      toastStore.success(`文件上传成功，已生成 ${result.data.chunkCount} 个片段`);
      showAddModal.value = false;
      selectedFile.value = null;
      fileTitle.value = '';
      await refresh();
    } else {
      toastStore.error(result.message || '上传失败');
    }
  } catch (error) {
    console.error('上传文件失败:', error);
    toastStore.error('上传文件失败');
  } finally {
    uploading.value = false;
  }
};

// 打开删除确认弹窗
const openDeleteConfirm = (doc) => {
  deletingDoc.value = doc;
  showDeleteConfirm.value = true;
};

// 确认删除
const confirmDelete = async () => {
  if (!deletingDoc.value) return;

  try {
    const result = await deleteDocument(deletingDoc.value.id);
    if (result.success) {
      toastStore.success('删除成功');
      await refresh();
    } else {
      toastStore.error(result.message || '删除失败');
    }
  } catch (error) {
    console.error('删除文档失败:', error);
    toastStore.error('删除文档失败');
  } finally {
    showDeleteConfirm.value = false;
    deletingDoc.value = null;
  }
};

// 关闭删除确认弹窗
const closeDeleteConfirm = () => {
  showDeleteConfirm.value = false;
  deletingDoc.value = null;
};

// 获取分类标签
const getCategoryLabel = (value) => {
  return categories.find(c => c.value === value)?.label || value;
};

// 格式化日期
const formatDate = (date) => {
  if (!date) return '-';
  return new Date(date).toLocaleString('zh-CN');
};

// 格式化文件大小
const formatSize = (length) => {
  if (!length) return '0 B';
  if (length < 1024) return `${length} 字符`;
  return `${(length / 1024).toFixed(1)} KB`;
};

// 格式化文件大小（字节）
const formatFileSize = (bytes) => {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

// 支持的文件类型
const supportedFileTypes = '.pdf, .docx, .doc, .txt, .md';

onMounted(() => {
  refresh();
});
</script>

<template>
  <div class="h-full flex flex-col p-6">
    <!-- 头部 -->
    <div class="flex items-center justify-between mb-5">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-violet-500/20">
          <Database :size="20" />
        </div>
        <div>
          <h1 class="text-lg font-bold text-slate-800 dark:text-white">知识库管理</h1>
          <p class="text-xs text-slate-500 dark:text-gray-400">星火知识库文档管理</p>
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
        <button
          @click="openAddModal"
          class="h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-xs bg-violet-600 text-white hover:bg-violet-700 transition-colors shadow-sm"
        >
          <Plus :size="14" />
          <span>添加文档</span>
        </button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div v-if="stats" class="grid grid-cols-2 gap-3 mb-5">
      <div class="rounded-xl border border-slate-200 dark:border-gray-700 bg-gradient-to-br from-blue-50 to-white dark:from-blue-900/20 dark:to-gray-800 p-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <FileText :size="16" />
          </div>
          <div>
            <p class="text-xl font-bold text-slate-800 dark:text-white">{{ stats.documents?.count || 0 }}</p>
            <p class="text-[10px] text-slate-500 dark:text-gray-400">文档总数</p>
          </div>
        </div>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-gray-700 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-900/20 dark:to-gray-800 p-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <Database :size="16" />
          </div>
          <div>
            <p class="text-xl font-bold text-slate-800 dark:text-white">星火知识库</p>
            <p class="text-[10px] text-slate-500 dark:text-gray-400">RAG 引擎</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 搜索和过滤 -->
    <div class="flex items-center gap-3 mb-4">
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
        v-model="selectedCategory"
        class="h-9 px-3 text-sm rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
      >
        <option value="">全部分类</option>
        <option v-for="cat in categories" :key="cat.value" :value="cat.value">{{ cat.label }}</option>
      </select>
    </div>

    <!-- 文档列表 -->
    <div class="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div v-if="loading" class="flex items-center justify-center h-48 text-slate-500 dark:text-gray-400">
        <RefreshCw class="animate-spin mr-2" :size="16" />
        加载中...
      </div>

      <div v-else-if="filteredDocuments.length === 0" class="flex flex-col items-center justify-center h-48 text-slate-500 dark:text-gray-400">
        <Database :size="40" class="mb-3 opacity-30" />
        <p class="text-sm">暂无文档</p>
        <p class="text-xs mt-1">点击「添加文档」开始构建知识库</p>
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
                <h3 class="text-sm font-medium text-slate-800 dark:text-gray-100 truncate">{{ doc.title }}</h3>
                <div class="flex items-center gap-2 mt-1">
                  <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                    {{ getCategoryLabel(doc.category) }}
                  </span>
                  <span class="text-[10px] text-slate-400 dark:text-gray-500">{{ formatSize(doc.contentLength) }}</span>
                  <span class="text-[10px] text-slate-400 dark:text-gray-500">{{ doc.chunkCount }} 片段</span>
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
              <p class="text-[10px] text-slate-500 dark:text-gray-400">{{ getCategoryLabel(previewDoc?.category) }} · {{ formatSize(previewDoc?.contentLength) }}</p>
            </div>
          </div>
          <button
            @click="showPreviewModal = false"
            class="w-8 h-8 rounded-lg inline-flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X :size="16" />
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-5">
          <div v-if="previewLoading" class="flex items-center justify-center h-32 text-slate-500 dark:text-gray-400">
            <RefreshCw class="animate-spin mr-2" :size="16" />
            加载中...
          </div>
          <div v-else class="text-sm text-slate-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{{ previewContent }}</div>
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
              placeholder="例如：计算机学院实验室介绍"
              class="w-full h-9 px-3 text-sm rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
          </div>

          <div>
            <label class="block text-xs font-medium text-slate-700 dark:text-gray-300 mb-1">分类</label>
            <select
              v-model="newDoc.category"
              class="w-full h-9 px-3 text-sm rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            >
              <option v-for="cat in categories" :key="cat.value" :value="cat.value">{{ cat.label }}</option>
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
            <label class="block text-xs font-medium text-slate-700 dark:text-gray-300 mb-1">分类</label>
            <select
              v-model="fileCategory"
              class="w-full h-9 px-3 text-sm rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            >
              <option v-for="cat in categories" :key="cat.value" :value="cat.value">{{ cat.label }}</option>
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
