<script setup lang="ts">
import { Calendar, CheckCircle, AlertCircle } from 'lucide-vue-next';

const StatCard = {
  props: ['title', 'value', 'icon', 'color', 'trend'],
  template: `
  <div class="bg-white dark:bg-gray-900 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-gray-800 hover:shadow-md transition-all duration-300 ease-in-out">
    <div class="flex justify-between items-start">
      <div>
        <p class="text-sm font-medium text-slate-500 dark:text-gray-400 transition-colors duration-300">{{ title }}</p>
        <h3 class="text-2xl font-bold text-slate-800 dark:text-white mt-1 transition-colors duration-300">{{ value }}</h3>
        <p v-if="trend" class="text-xs text-green-500 mt-2 flex items-center">↑ {{ trend }} 较上周</p>
      </div>
      <div :class="['p-3 rounded-lg shadow-lg', color, 'shadow-' + color.replace('bg-', '') + '/20']">
        <component :is="icon" :size="22" class="text-white" />
      </div>
    </div>
  </div>
  `
};

const courses = [
  { time: '08:00 - 09:35', name: '高等数学 A', loc: '鉴主 401', status: 'finished' },
  { time: '10:05 - 11:40', name: '大学物理', loc: '新一 302', status: 'active' },
  { time: '14:00 - 15:35', name: '数据结构', loc: '南湖 N201', status: 'upcoming' },
];

const chartData = [
  { name: 'Mon', hours: 4 },
  { name: 'Tue', hours: 6 },
  { name: 'Wed', hours: 8 },
  { name: 'Thu', hours: 5 },
  { name: 'Fri', hours: 7 },
  { name: 'Sat', hours: 3 },
  { name: 'Sun', hours: 2 },
];
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="flex justify-between items-center">
      <div>
        <h2 class="text-2xl font-bold text-slate-800 dark:text-white transition-colors duration-300">欢迎回来, 武理学子 👋</h2>
        <p class="text-slate-500 dark:text-gray-400 transition-colors duration-300">这是今天的校园概览</p>
      </div>
      <div class="text-right hidden md:block">
          <p class="text-sm font-medium text-slate-700 dark:text-gray-300 transition-colors duration-300">{{ new Date().toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) }}</p>
          <p class="text-xs text-slate-500 dark:text-gray-500 transition-colors duration-300">第 5 教学周</p>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <StatCard title="待办事项" value="12" :icon="CheckCircle" color="bg-blue-500" trend="15%" />
      <StatCard title="即将截止" value="3" :icon="AlertCircle" color="bg-rose-500" />
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 bg-white dark:bg-gray-900 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-gray-800 transition-all duration-300 ease-in-out">
        <h3 class="font-bold text-slate-800 dark:text-white mb-4 flex items-center transition-colors duration-300">
          <Calendar class="w-5 h-5 mr-2 text-blue-500" />
          课程表 (今日)
        </h3>
        <div class="space-y-4">
           <div 
             v-for="(course, idx) in courses" 
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
                {{ course.status === 'finished' ? '已结课' : course.status === 'active' ? '进行中' : '未开始' }}
              </span>
           </div>
        </div>
      </div>

      <div class="bg-white dark:bg-gray-900 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-gray-800 transition-all duration-300 ease-in-out flex flex-col">
         <h3 class="font-bold text-slate-800 dark:text-white mb-4 transition-colors duration-300">学习专注度</h3>
         <div class="h-64 w-full flex items-end justify-between px-2 pb-2 flex-1">
            <div v-for="d in chartData" :key="d.name" class="flex flex-col items-center gap-2 group w-full">
              <div class="w-full max-w-[24px] bg-slate-100 dark:bg-gray-800 rounded-t-md relative h-40 flex items-end overflow-hidden">
                 <div 
                   :style="{ height: `${d.hours * 10}%` }" 
                   :class="[
                     'w-full transition-all duration-500', 
                     d.hours > 6 ? 'bg-blue-600 dark:bg-blue-500' : 'bg-blue-300 dark:bg-blue-800'
                   ]"
                 ></div>
                 <div class="absolute bottom-full mb-1 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap left-1/2 -translate-x-1/2 pointer-events-none z-10">
                   {{ d.hours }} 小时
                 </div>
              </div>
              <span class="text-xs text-slate-400 dark:text-gray-500 font-mono">{{ d.name }}</span>
            </div>
         </div>
      </div>
    </div>
  </div>
</template>