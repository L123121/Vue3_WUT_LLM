<script setup>
import { computed, ref } from 'vue';
import { useLanguageStore } from '../../stores/language.store.js';
import { useSkillStore } from '../../stores/skill.store.js';
import { Sparkles, Download, Trash2 } from 'lucide-vue-next';

const languageStore = useLanguageStore();
const skillStore = useSkillStore();
const githubUrl = ref('');
const error = ref('');

const labels = computed(() => {
  if (languageStore.isChinese) {
    return {
      title: 'Skills',
      subtitle: '支持导入 GitHub Skill.md',
      placeholder: '粘贴 GitHub skill 链接（blob/..../SKILL.md）',
      add: '导入',
      enabled: '已启用',
      empty: '暂无 skill，导入后可增强回答风格',
    };
  }
  return {
    title: 'Skills',
    subtitle: 'Import GitHub SKILL.md',
    placeholder: 'Paste GitHub skill URL (blob/.../SKILL.md)',
    add: 'Import',
    enabled: 'Enabled',
    empty: 'No skill imported yet',
  };
});

const handleImport = async () => {
  error.value = '';
  try {
    await skillStore.addSkillFromGithub(githubUrl.value);
    githubUrl.value = '';
  } catch (err) {
    error.value = err.message || '导入失败';
  }
};
</script>

<template>
  <div class="rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/80 dark:bg-gray-900/60 p-3">
    <div class="flex items-center gap-2 mb-2">
      <Sparkles :size="14" class="text-violet-500" />
      <h4 class="text-xs font-bold text-slate-700 dark:text-gray-200 uppercase tracking-wide">{{ labels.title }}</h4>
    </div>
    <p class="text-[11px] text-slate-500 dark:text-gray-400 mb-2">{{ labels.subtitle }}</p>

    <div class="flex items-center gap-2 mb-2">
      <input
        v-model="githubUrl"
        :placeholder="labels.placeholder"
        class="flex-1 h-8 px-2.5 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
      />
      <button
        @click="handleImport"
        :disabled="skillStore.importing"
        class="h-8 px-2.5 rounded-lg bg-violet-600 text-white text-xs hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1"
      >
        <Download :size="12" />
        {{ labels.add }}
      </button>
    </div>

    <p v-if="error" class="text-[11px] text-rose-500 mb-2">{{ error }}</p>

    <div v-if="skillStore.skills.length === 0" class="text-[11px] text-slate-400 dark:text-gray-500 py-1">
      {{ labels.empty }}
    </div>

    <ul v-else class="space-y-1.5 max-h-56 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-gray-700 scrollbar-track-transparent pr-1">
      <li v-for="skill in skillStore.skills" :key="skill.id" class="rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2">
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs font-medium text-slate-700 dark:text-gray-200 truncate">{{ skill.name }}</p>
          <div class="flex items-center gap-1">
            <button
              @click="skillStore.toggleSkill(skill.id)"
              :class="[
                'px-1.5 py-0.5 rounded text-[10px]',
                skill.enabled
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'bg-slate-100 text-slate-500 dark:bg-gray-700 dark:text-gray-300'
              ]"
            >
              {{ skill.enabled ? labels.enabled : 'Off' }}
            </button>
            <button @click="skillStore.removeSkill(skill.id)" class="p-1 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20">
              <Trash2 :size="12" />
            </button>
          </div>
        </div>
        <p class="text-[10px] text-slate-500 dark:text-gray-400 truncate mt-1">{{ skill.description || skill.sourceUrl }}</p>
      </li>
    </ul>
  </div>
</template>
