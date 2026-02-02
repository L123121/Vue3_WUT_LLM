<script setup lang="ts">
import { Code, Database, Layout, Smartphone, Zap, Layers } from 'lucide-vue-next';
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-8 animate-fade-in">
    <!-- Header Section -->
    <div class="bg-gradient-to-r from-green-600 to-teal-700 rounded-2xl p-8 text-white shadow-xl relative overflow-hidden">
      <div class="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -mr-12 -mt-12 blur-3xl"></div>
      <div class="relative z-10">
        <h2 class="text-3xl font-bold mb-2">关于本应用</h2>
        <p class="text-green-50 max-w-2xl">
          "武理小精灵" 是一款专为武汉理工大学师生设计的现代化校园助手应用。
          集成待办事项管理、课程查询及先进的 AI 智能问答系统，旨在提升您的校园生活效率。
        </p>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
      <!-- Tech Stack -->
      <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-gray-700 transition-colors">
        <h3 class="text-xl font-bold text-slate-800 dark:text-white mb-6 flex items-center border-b border-slate-100 dark:border-gray-700 pb-4">
          <Code class="mr-2 text-green-500" /> 技术栈
        </h3>
        <ul class="space-y-4">
           <li class="flex items-start">
             <div class="bg-green-50 dark:bg-green-900/30 p-2 rounded-lg mr-4">
               <Layers :size="18" class="text-green-600 dark:text-green-400" />
             </div>
             <div>
               <span class="block font-semibold text-slate-800 dark:text-gray-200">Vue 3 / Composition API</span>
               <span class="text-sm text-slate-500 dark:text-gray-400">现代化前端响应式框架</span>
             </div>
           </li>
           <li class="flex items-start">
             <div class="bg-green-50 dark:bg-green-900/30 p-2 rounded-lg mr-4">
               <Code :size="18" class="text-green-600 dark:text-green-400" />
             </div>
             <div>
               <span class="block font-semibold text-slate-800 dark:text-gray-200">TypeScript</span>
               <span class="text-sm text-slate-500 dark:text-gray-400">强类型编程语言，安全可靠</span>
             </div>
           </li>
           <li class="flex items-start">
             <div class="bg-green-50 dark:bg-green-900/30 p-2 rounded-lg mr-4">
               <Layout :size="18" class="text-green-600 dark:text-green-400" />
             </div>
             <div>
               <span class="block font-semibold text-slate-800 dark:text-gray-200">Tailwind CSS</span>
               <span class="text-sm text-slate-500 dark:text-gray-400">原子化 CSS 引擎，极速构建 UI</span>
             </div>
           </li>
           <li class="flex items-start">
             <div class="bg-green-50 dark:bg-green-900/30 p-2 rounded-lg mr-4">
               <Zap :size="18" class="text-green-600 dark:text-green-400" />
             </div>
             <div>
               <span class="block font-semibold text-slate-800 dark:text-gray-200">Xunfei Spark MaaS</span>
               <span class="text-sm text-slate-500 dark:text-gray-400">基于 Qwen3-1.7B 的大语言模型</span>
             </div>
           </li>
           <li class="flex items-start">
             <div class="bg-green-50 dark:bg-green-900/30 p-2 rounded-lg mr-4">
               <Smartphone :size="18" class="text-green-600 dark:text-green-400" />
             </div>
             <div>
               <span class="block font-semibold text-slate-800 dark:text-gray-200">Vite</span>
               <span class="text-sm text-slate-500 dark:text-gray-400">下一代前端构建工具</span>
             </div>
           </li>
        </ul>
      </div>

      <!-- Features -->
      <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-gray-700 transition-colors">
        <h3 class="text-xl font-bold text-slate-800 dark:text-white mb-6 flex items-center border-b border-slate-100 dark:border-gray-700 pb-4">
          <Database class="mr-2 text-teal-500" /> 功能特点
        </h3>
        <div class="grid grid-cols-1 gap-4">
           <div class="p-4 rounded-lg bg-slate-50 dark:bg-gray-700/50 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors border border-transparent hover:border-green-200 dark:hover:border-green-800">
             <h4 class="font-semibold text-slate-800 dark:text-gray-200 mb-1">待办事项管理</h4>
             <p class="text-sm text-slate-500 dark:text-gray-400 leading-relaxed">支持分类、筛选与批量删除，让任务井井有条。</p>
           </div>
           <div class="p-4 rounded-lg bg-slate-50 dark:bg-gray-700/50 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors border border-transparent hover:border-green-200 dark:hover:border-green-800">
             <h4 class="font-semibold text-slate-800 dark:text-gray-200 mb-1">响应式布局</h4>
             <p class="text-sm text-slate-500 dark:text-gray-400 leading-relaxed">完美适配桌面端、平板与手机，随时随地访问。</p>
           </div>
           <div class="p-4 rounded-lg bg-slate-50 dark:bg-gray-700/50 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors border border-transparent hover:border-green-200 dark:hover:border-green-800">
             <h4 class="font-semibold text-slate-800 dark:text-gray-200 mb-1">AI 智能对话</h4>
             <p class="text-sm text-slate-500 dark:text-gray-400 leading-relaxed">集成 Qwen LLM 模型，提供智能问答、翻译与写作辅助。</p>
           </div>
           <div class="p-4 rounded-lg bg-slate-50 dark:bg-gray-700/50 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors border border-transparent hover:border-green-200 dark:hover:border-green-800">
             <h4 class="font-semibold text-slate-800 dark:text-gray-200 mb-1">Vue 3 驱动</h4>
             <p class="text-sm text-slate-500 dark:text-gray-400 leading-relaxed">使用最新的 Vue Composition API 重构，性能更强。</p>
           </div>
        </div>
      </div>
    </div>
  </div>
</template>