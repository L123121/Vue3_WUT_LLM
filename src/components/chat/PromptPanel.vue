<script setup>
import { computed, ref } from 'vue';
import { usePromptStore } from '../../stores/prompt.store.js';
import { FileText, Plus, Pencil, Trash2, Copy, Check, X } from 'lucide-vue-next';

const promptStore = usePromptStore();

const showEditor = ref(false);
const editingPrompt = ref(null);
const formData = ref({ name: '', content: '', category: '通用' });
const filterCategory = ref('全部');

const filteredPrompts = computed(() => {
  if (filterCategory.value === '全部') {
    return promptStore.prompts;
  }
  return promptStore.prompts.filter((p) => p.category === filterCategory.value);
});

const openAddEditor = () => {
  editingPrompt.value = null;
  formData.value = { name: '', content: '', category: '通用' };
  showEditor.value = true;
};

const openEditEditor = (prompt) => {
  editingPrompt.value = prompt;
  formData.value = {
    name: prompt.name,
    content: prompt.content,
    category: prompt.category,
  };
  showEditor.value = true;
};

const closeEditor = () => {
  showEditor.value = false;
  editingPrompt.value = null;
};

const savePrompt = () => {
  if (!formData.value.name.trim() || !formData.value.content.trim()) {
    return;
  }

  if (editingPrompt.value) {
    promptStore.updatePrompt(editingPrompt.value.id, formData.value);
  } else {
    promptStore.addPrompt(formData.value);
  }

  closeEditor();
};

const handleDelete = (id) => {
  if (confirm('确定要删除这个提示词吗？')) {
    promptStore.removePrompt(id);
  }
};

const handleDuplicate = (id) => {
  promptStore.duplicatePrompt(id);
};
</script>

<template>
  <div class="rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/80 dark:bg-gray-900/60 p-3">
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <FileText :size="14" class="text-blue-500" />
        <h4 class="text-xs font-bold text-slate-700 dark:text-gray-200 uppercase tracking-wide">提示词</h4>
      </div>
      <button
        @click="openAddEditor"
        class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-blue-500 text-white hover:bg-blue-600 transition-colors"
      >
        <Plus :size="12" />
        新建
      </button>
    </div>

    <!-- 分类筛选 -->
    <div class="flex gap-1 mb-2 overflow-x-auto pb-1">
      <button
        v-for="cat in promptStore.categories"
        :key="cat"
        @click="filterCategory = cat"
        :class="[
          'px-2 py-0.5 rounded text-[10px] whitespace-nowrap transition-colors',
          filterCategory === cat
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
            : 'bg-slate-100 text-slate-500 dark:bg-gray-800 dark:text-gray-400 hover:bg-slate-200 dark:hover:bg-gray-700'
        ]"
      >
        {{ cat }}
      </button>
    </div>

    <!-- 提示词列表 -->
    <div v-if="filteredPrompts.length === 0" class="text-[11px] text-slate-400 dark:text-gray-500 py-2 text-center">
      暂无提示词
    </div>

    <ul v-else class="space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-gray-700 scrollbar-track-transparent pr-1">
      <li
        v-for="prompt in filteredPrompts"
        :key="prompt.id"
        :class="[
          'rounded-lg border p-2 cursor-pointer transition-all',
          promptStore.selectedPromptId === prompt.id
            ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-500'
            : 'border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-slate-300 dark:hover:border-gray-600'
        ]"
        @click="promptStore.selectPrompt(prompt.id)"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <p class="text-xs font-medium text-slate-700 dark:text-gray-200 truncate">{{ prompt.name }}</p>
              <span class="px-1 py-0.5 rounded text-[9px] bg-slate-100 dark:bg-gray-700 text-slate-500 dark:text-gray-400">
                {{ prompt.category }}
              </span>
            </div>
            <p class="text-[10px] text-slate-500 dark:text-gray-400 truncate mt-0.5">{{ prompt.content }}</p>
          </div>
          <div class="flex items-center gap-0.5 shrink-0">
            <button
              v-if="promptStore.selectedPromptId === prompt.id"
              class="p-1 rounded text-blue-500 bg-blue-100 dark:bg-blue-900/30"
              title="已选中"
            >
              <Check :size="12" />
            </button>
            <button
              @click.stop="openEditEditor(prompt)"
              class="p-1 rounded text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
              title="编辑"
            >
              <Pencil :size="12" />
            </button>
            <button
              @click.stop="handleDuplicate(prompt.id)"
              class="p-1 rounded text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
              title="复制"
            >
              <Copy :size="12" />
            </button>
            <button
              @click.stop="handleDelete(prompt.id)"
              class="p-1 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20"
              title="删除"
            >
              <Trash2 :size="12" />
            </button>
          </div>
        </div>
      </li>
    </ul>

    <!-- 编辑器弹窗 -->
    <div v-if="showEditor" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @click.self="closeEditor">
      <div class="w-[90%] max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-slate-200 dark:border-gray-700 p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-bold text-slate-800 dark:text-white">
            {{ editingPrompt ? '编辑提示词' : '新建提示词' }}
          </h3>
          <button @click="closeEditor" class="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-gray-200">
            <X :size="16" />
          </button>
        </div>

        <div class="space-y-3">
          <div>
            <label class="block text-[11px] font-medium text-slate-600 dark:text-gray-300 mb-1">名称</label>
            <input
              v-model="formData.name"
              placeholder="输入提示词名称"
              class="w-full h-9 px-3 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div>
            <label class="block text-[11px] font-medium text-slate-600 dark:text-gray-300 mb-1">分类</label>
            <input
              v-model="formData.category"
              placeholder="输入分类名称"
              class="w-full h-9 px-3 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div>
            <label class="block text-[11px] font-medium text-slate-600 dark:text-gray-300 mb-1">内容</label>
            <textarea
              v-model="formData.content"
              placeholder="输入提示词内容..."
              rows="5"
              class="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
            ></textarea>
          </div>
        </div>

        <div class="flex justify-end gap-2 mt-4">
          <button
            @click="closeEditor"
            class="px-3 py-1.5 rounded-lg text-xs text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-800"
          >
            取消
          </button>
          <button
            @click="savePrompt"
            :disabled="!formData.name.trim() || !formData.content.trim()"
            class="px-3 py-1.5 rounded-lg text-xs bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
