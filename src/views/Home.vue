<script setup>
import { computed } from 'vue';
import { Calendar, CheckCircle, AlertCircle } from 'lucide-vue-next';
import { useLanguageStore } from '../stores/language.store.js';

const languageStore = useLanguageStore();
const text = computed(() => languageStore.tm('home'));
const todayLabel = computed(() => languageStore.formatDate(new Date(), {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
}));

const StatCard = {
  props: ['title', 'value', 'icon', 'color', 'trend', 'compareLabel'],
  template: `
  <div class="bg-white dark:bg-gray-900 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-gray-800 hover:shadow-md transition-all duration-300 ease-in-out">
    <div class="flex justify-between items-start">
      <div>
        <p class="text-sm font-medium text-slate-500 dark:text-gray-400 transition-colors duration-300">{{ title }}</p>
        <h3 class="text-2xl font-bold text-slate-800 dark:text-white mt-1 transition-colors duration-300">{{ value }}</h3>
        <p v-if="trend" class="text-xs text-green-500 mt-2 flex items-center">↑ {{ trend }} {{ compareLabel }}</p>
      </div>
      <div :class="['p-3 rounded-lg shadow-lg', color, 'shadow-' + color.replace('bg-', '') + '/20']">
        <component :is="icon" :size="22" class="text-white" />
      </div>
    </div>
  </div>
  `,
};

const getCourseStatusLabel = (status) => {
  if (status === 'finished') return text.value.finished;
  if (status === 'active') return text.value.active;
  return text.value.future;
};

const openTool = (url) => {
  window.location.href = url;
};
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="flex justify-between items-center">
      <div>
        <h2 class="text-2xl font-bold text-slate-800 dark:text-white transition-colors duration-300">{{ text.welcome }}</h2>
        <p class="text-slate-500 dark:text-gray-400 transition-colors duration-300">{{ text.subtitle }}</p>
      </div>
      <div class="text-right hidden md:block">
        <p class="text-sm font-medium text-slate-700 dark:text-gray-300 transition-colors duration-300">{{ todayLabel }}</p>
        <p class="text-xs text-slate-500 dark:text-gray-500 transition-colors duration-300">{{ text.week }}</p>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <StatCard :title="text.todos" value="12" :icon="CheckCircle" color="bg-blue-500" trend="15%" :compare-label="text.compare" />
      <StatCard :title="text.upcoming" value="3" :icon="AlertCircle" color="bg-rose-500" />
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 bg-white dark:bg-gray-900 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-gray-800 transition-all duration-300 ease-in-out">
        <h3 class="font-bold text-slate-800 dark:text-white mb-4 flex items-center transition-colors duration-300">
          <Calendar class="w-5 h-5 mr-2 text-blue-500" />
          {{ text.schedule }}
        </h3>
        <div class="space-y-4">
          <div
            v-for="(course, idx) in text.courses"
            :key="idx"
            class="flex items-center p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-800 transition-all duration-200 border-l-4 border-transparent hover:border-blue-500 group"
          >
            <div class="w-32 text-sm text-slate-500 dark:text-gray-400 font-mono transition-colors duration-300">{{ course.time }}</div>
            <div class="flex-1">
              <div class="font-semibold text-slate-800 dark:text-white transition-colors duration-300">{{ course.name }}</div>
              <div class="text-xs text-slate-500 dark:text-gray-500 transition-colors duration-300">{{ course.loc }}</div>
            </div>
            <span :class="[
              'px-2 py-1 rounded text-xs font-medium transition-colors duration-300',
              course.status === 'finished' ? 'bg-slate-100 dark:bg-gray-800 text-slate-400 dark:text-gray-500' :
              course.status === 'active' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
            ]">
              {{ getCourseStatusLabel(course.status) }}
            </span>
          </div>
        </div>
      </div>

      <div class="bg-white dark:bg-gray-900 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-gray-800 transition-all duration-300 ease-in-out flex flex-col">
        <h3 class="font-bold text-slate-800 dark:text-white mb-4 transition-colors duration-300">{{ text.quickTools }}</h3>
        <div class="grid grid-cols-2 gap-3 flex-1">
          <div
            v-for="(toolName, index) in text.tools"
            :key="toolName"
            @click="openTool('https://one.whut.edu.cn/tpass/login')"
            class="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-md bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300"
          >
            <span class="text-2xl">{{ ['📅','📊','📢','💳'][index] }}</span>
            <span class="text-sm font-medium">{{ toolName }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
