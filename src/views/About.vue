<script setup>
import { computed } from 'vue';
import { Code, Database, Layout, Smartphone, Zap, Layers } from 'lucide-vue-next';
import { useLanguageStore } from '../stores/language.store.js';

const languageStore = useLanguageStore();
const text = computed(() => languageStore.tm('about'));
const stackIcons = [Layers, Code, Layout, Zap, Smartphone];
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-8 animate-fade-in">
    <div class="bg-gradient-to-r from-green-600 to-teal-700 rounded-2xl p-8 text-white shadow-xl relative overflow-hidden">
      <div class="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -mr-12 -mt-12 blur-3xl"></div>
      <div class="relative z-10">
        <h2 class="text-3xl font-bold mb-2">{{ text.title }}</h2>
        <p class="text-green-50 max-w-2xl">
          {{ text.description }}
        </p>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
      <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-gray-700 transition-colors">
        <h3 class="text-xl font-bold text-slate-800 dark:text-white mb-6 flex items-center border-b border-slate-100 dark:border-gray-700 pb-4">
          <Code class="mr-2 text-green-500" /> {{ text.stackTitle }}
        </h3>
        <ul class="space-y-4">
          <li v-for="(item, index) in text.stack" :key="item.title" class="flex items-start">
            <div class="bg-green-50 dark:bg-green-900/30 p-2 rounded-lg mr-4">
              <component :is="stackIcons[index]" :size="18" class="text-green-600 dark:text-green-400" />
            </div>
            <div>
              <span class="block font-semibold text-slate-800 dark:text-gray-200">{{ item.title }}</span>
              <span class="text-sm text-slate-500 dark:text-gray-400">{{ item.desc }}</span>
            </div>
          </li>
        </ul>
      </div>

      <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-gray-700 transition-colors">
        <h3 class="text-xl font-bold text-slate-800 dark:text-white mb-6 flex items-center border-b border-slate-100 dark:border-gray-700 pb-4">
          <Database class="mr-2 text-teal-500" /> {{ text.featuresTitle }}
        </h3>
        <div class="grid grid-cols-1 gap-4">
          <div v-for="feature in text.features" :key="feature.title" class="p-4 rounded-lg bg-slate-50 dark:bg-gray-700/50 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors border border-transparent hover:border-green-200 dark:hover:border-green-800">
            <h4 class="font-semibold text-slate-800 dark:text-gray-200 mb-1">{{ feature.title }}</h4>
            <p class="text-sm text-slate-500 dark:text-gray-400 leading-relaxed">{{ feature.desc }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
