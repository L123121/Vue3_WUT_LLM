<script setup>
import { X } from 'lucide-vue-next';

defineProps({ show: Boolean, currentAvatar: String });
const emit = defineEmits(['close', 'select']);

const presetAvatars = [
  'https://api.dicebear.com/7.x/notionists/svg?seed=Felix',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Aneka',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Bailey',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Cleo',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Dusty',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Eden',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Flora',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Grace',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Happy',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Joy',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Bot1',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Bot2',
];
</script>

<template>
  <div
    v-if="show"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-sm mx-4 rounded-2xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl p-4">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-bold text-slate-800 dark:text-white">选择头像</h3>
        <button
          @click="emit('close')"
          class="w-7 h-7 rounded-lg inline-flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
        >
          <X :size="14" />
        </button>
      </div>
      <div class="grid grid-cols-4 gap-2">
        <button
          v-for="(avatar, index) in presetAvatars"
          :key="index"
          @click="emit('select', avatar)"
          class="w-full aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-violet-400 dark:hover:border-violet-500 transition-colors"
          :class="{ 'border-violet-500': currentAvatar === avatar }"
        >
          <img :src="avatar" alt="头像" class="w-full h-full object-cover bg-slate-100 dark:bg-gray-800" />
        </button>
      </div>
      <p class="mt-3 text-[10px] text-slate-400 dark:text-gray-500 text-center">点击选择预设头像</p>
    </div>
  </div>
</template>
