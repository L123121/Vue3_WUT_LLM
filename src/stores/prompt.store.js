import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

const STORAGE_KEY = 'custom_prompts';

const normalizePrompt = (prompt) => ({
  id: String(prompt.id || `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
  name: String(prompt.name || '未命名提示词').trim(),
  content: String(prompt.content || '').trim(),
  category: String(prompt.category || '通用').trim(),
  createdAt: new Date(prompt.createdAt || Date.now()),
  updatedAt: new Date(prompt.updatedAt || Date.now()),
});

const loadPrompts = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizePrompt);
  } catch {
    return [];
  }
};

// 默认提示词模板
const defaultPrompts = [
  {
    id: 'default-1',
    name: '代码助手',
    content: '你是一个专业的编程助手，请用简洁清晰的语言回答编程相关问题，并提供代码示例。',
    category: '编程',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'default-2',
    name: '翻译专家',
    content: '你是一个专业的翻译助手，请准确翻译用户提供的内容，保持原文的语气和风格。',
    category: '翻译',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'default-3',
    name: '学习助手',
    content: '你是一个耐心的学习助手，请用通俗易懂的语言解释概念，并提供实际例子帮助理解。',
    category: '学习',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

export const usePromptStore = defineStore('prompt', () => {
  const prompts = ref(loadPrompts());
  const selectedPromptId = ref(null);

  // 如果没有提示词，初始化默认提示词
  if (prompts.value.length === 0) {
    prompts.value = defaultPrompts.map(normalizePrompt);
  }

  const selectedPrompt = computed(() => {
    if (!selectedPromptId.value) return null;
    return prompts.value.find((p) => p.id === selectedPromptId.value) || null;
  });

  const categories = computed(() => {
    const cats = new Set(prompts.value.map((p) => p.category));
    return ['全部', ...Array.from(cats)];
  });

  let saveTimer = null;
  watch(
    prompts,
    () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts.value));
        saveTimer = null;
      }, 300);
    },
    { deep: true }
  );

  const addPrompt = (data) => {
    const prompt = normalizePrompt({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prompts.value.unshift(prompt);
    return prompt;
  };

  const updatePrompt = (id, data) => {
    const index = prompts.value.findIndex((p) => p.id === id);
    if (index !== -1) {
      prompts.value[index] = normalizePrompt({
        ...prompts.value[index],
        ...data,
        updatedAt: new Date(),
      });
    }
  };

  const removePrompt = (id) => {
    const index = prompts.value.findIndex((p) => p.id === id);
    if (index !== -1) {
      prompts.value.splice(index, 1);
      if (selectedPromptId.value === id) {
        selectedPromptId.value = null;
      }
    }
  };

  const selectPrompt = (id) => {
    selectedPromptId.value = selectedPromptId.value === id ? null : id;
  };

  const duplicatePrompt = (id) => {
    const original = prompts.value.find((p) => p.id === id);
    if (original) {
      const copy = normalizePrompt({
        ...original,
        name: `${original.name} (副本)`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prompts.value.unshift(copy);
      return copy;
    }
    return null;
  };

  const getPromptContent = () => {
    return selectedPrompt.value?.content || '';
  };

  return {
    prompts,
    selectedPromptId,
    selectedPrompt,
    categories,
    addPrompt,
    updatePrompt,
    removePrompt,
    selectPrompt,
    duplicatePrompt,
    getPromptContent,
  };
});
