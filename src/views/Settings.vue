<template>
  <div class="min-h-screen bg-slate-50 dark:bg-gray-950 p-4 md:p-8 transition-colors duration-500">
    <div class="max-w-2xl mx-auto">
      <!-- 标题 -->
      <h1 class="text-2xl font-bold text-slate-800 dark:text-white mb-6 flex items-center gap-2">
        <Settings :size="24" class="text-slate-600 dark:text-gray-400" />
        设置
      </h1>

      <!-- 功能说明 -->
      <section class="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-slate-200 dark:border-gray-800 p-5">
        <h2 class="text-base font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
          <span class="text-lg">📋</span> 已对接功能
        </h2>
        <div class="space-y-0">
          <div v-for="feature in features" :key="feature.name" class="flex items-center gap-3 py-3 border-b border-slate-100 dark:border-gray-800 last:border-b-0">
            <span class="text-xl">{{ feature.icon }}</span>
            <span class="flex-1 text-sm font-medium text-slate-700 dark:text-gray-200">{{ feature.name }}</span>
            <span class="text-xs px-2.5 py-0.5 rounded-full font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
              {{ feature.status }}
            </span>
          </div>
        </div>
      </section>

      <!-- 底部版权 -->
      <p class="text-center text-xs text-slate-400 dark:text-gray-600 mt-6">
        &copy; {{ new Date().getFullYear() }} 武汉理工大学 WUT
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { Settings } from 'lucide-vue-next'

const features = [
  { icon: '💬', name: 'AI 智能对话', status: '可用' },
  { icon: '📊', name: '成绩查询', status: '开发中' },
  { icon: '📚', name: '课表查询', status: '开发中' },
  { icon: '📝', name: '考试安排', status: '开发中' },
]
</script>
