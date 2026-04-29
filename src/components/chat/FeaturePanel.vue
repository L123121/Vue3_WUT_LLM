<script setup>
import { ref, computed } from 'vue';
import {
  Layers,
  Zap,
  Github,
  History,
  Mic,
  Code2,
  ChevronRight,
  ExternalLink,
  CheckCircle2,
} from 'lucide-vue-next';

const expandedSection = ref(null);

const toggleSection = (section) => {
  expandedSection.value = expandedSection.value === section ? null : section;
};

const features = [
  {
    id: 'architecture',
    icon: Layers,
    title: '模块化工程架构',
    subtitle: 'Vue3 + Vite + 组合式 API',
    color: 'blue',
    description: '采用 Vue3 + Vite 构建现代化前端工程，使用组合式 API (Composition API) 编写核心逻辑，实现业务模块解耦与高复用性。',
    highlights: [
      'Vite 极速构建与热更新',
      'Pinia 状态管理，模块化 Store 设计',
      '组件化设计，单一职责原则',
      '路由懒加载，按需引入',
    ],
    tech: ['Vue 3.4', 'Vite 5', 'Pinia 2', 'Vue Router 4'],
  },
  {
    id: 'streaming',
    icon: Zap,
    title: 'LLM 流式响应',
    subtitle: 'SSE 协议 + 多轮上下文',
    color: 'violet',
    description: '封装 LLM API 实现流式响应与多轮上下文管理，通过 SSE (Server-Sent Events) 协议优化数据传输，实现逐字输出、滚动跟随与长文本生成的平滑体验。',
    highlights: [
      'SSE 流式传输，实时响应',
      '多轮对话上下文管理',
      '自动重试与错误处理',
      '打字机效果，平滑滚动跟随',
    ],
    tech: ['Fetch API', 'ReadableStream', 'SSE', 'AbortController'],
  },
  {
    id: 'skills',
    icon: Github,
    title: 'GitHub Skills 导入',
    subtitle: '远程 SKILL.md 解析',
    color: 'amber',
    description: '实现 GitHub Skills 导入与自定义 prompt 系统，支持远程 SKILL.md 解析，动态注入系统提示词增强 AI 回答风格。',
    highlights: [
      'GitHub Raw 链接自动转换',
      'Markdown 格式解析',
      '多 Skill 组合注入',
      '自定义提示词模板管理',
    ],
    tech: ['Fetch API', 'Markdown Parser', 'LocalStorage'],
  },
  {
    id: 'history',
    icon: History,
    title: '会话历史管理',
    subtitle: 'Pinia + localStorage 持久化',
    color: 'emerald',
    description: '构建会话历史管理功能，结合 Pinia 与 localStorage 完成消息缓存、上下文恢复与对话回溯能力，提升用户使用连续性。',
    highlights: [
      '多会话管理，独立上下文',
      'localStorage 自动持久化',
      '会话搜索与过滤',
      '虚拟滚动优化长列表',
    ],
    tech: ['Pinia', 'LocalStorage', 'vue-virtual-scroller'],
  },
  {
    id: 'voice',
    icon: Mic,
    title: '语音输入模块',
    subtitle: 'Web Speech API',
    color: 'rose',
    description: '基于 Web Speech API 构建语音输入模块，实现实时语音转写与可视化状态反馈，丰富交互模态。',
    highlights: [
      '实时语音识别转文字',
      '多语言支持（中/英）',
      '可视化录音状态反馈',
      '权限检测与错误提示',
    ],
    tech: ['Web Speech API', 'SpeechRecognition'],
  },
  {
    id: 'markdown',
    icon: Code2,
    title: 'Markdown 渲染',
    subtitle: '15+ 语言代码高亮',
    color: 'cyan',
    description: '集成 Markdown-it + Highlight.js，支持 15+ 种编程语言的代码高亮展示与一键复制，提升技术内容展示质量。',
    highlights: [
      'Markdown-it 全功能渲染',
      'Highlight.js 语法高亮',
      '动态语言包加载',
      '一键复制代码块',
    ],
    tech: ['Markdown-it', 'Highlight.js', '15+ Languages'],
  },
];

const colorClasses = {
  blue: {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-800',
    highlight: 'bg-blue-50 dark:bg-blue-900/20',
  },
  violet: {
    bg: 'bg-violet-100 dark:bg-violet-900/30',
    text: 'text-violet-600 dark:text-violet-400',
    border: 'border-violet-200 dark:border-violet-800',
    highlight: 'bg-violet-50 dark:bg-violet-900/20',
  },
  amber: {
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    text: 'text-amber-600 dark:text-amber-400',
    border: 'border-amber-200 dark:border-amber-800',
    highlight: 'bg-amber-50 dark:bg-amber-900/20',
  },
  emerald: {
    bg: 'bg-emerald-100 dark:bg-emerald-900/30',
    text: 'text-emerald-600 dark:text-emerald-400',
    border: 'border-emerald-200 dark:border-emerald-800',
    highlight: 'bg-emerald-50 dark:bg-emerald-900/20',
  },
  rose: {
    bg: 'bg-rose-100 dark:bg-rose-900/30',
    text: 'text-rose-600 dark:text-rose-400',
    border: 'border-rose-200 dark:border-rose-800',
    highlight: 'bg-rose-50 dark:bg-rose-900/20',
  },
  cyan: {
    bg: 'bg-cyan-100 dark:bg-cyan-900/30',
    text: 'text-cyan-600 dark:text-cyan-400',
    border: 'border-cyan-200 dark:border-cyan-800',
    highlight: 'bg-cyan-50 dark:bg-cyan-900/20',
  },
};

const stats = computed(() => [
  { label: '核心模块', value: '6', unit: '个' },
  { label: '支持语言', value: '15+', unit: '种' },
  { label: 'API 封装', value: '3', unit: '层' },
  { label: '状态管理', value: '7', unit: 'Store' },
]);
</script>

<template>
  <div class="p-4 space-y-4">
    <!-- 标题 -->
    <div class="text-center mb-6">
      <h2 class="text-lg font-bold text-slate-800 dark:text-white mb-1">武理小精灵</h2>
      <p class="text-xs text-slate-500 dark:text-gray-400">Vue3 AI 助手技术架构</p>
    </div>

    <!-- 统计数据 -->
    <div class="grid grid-cols-4 gap-2 mb-4">
      <div
        v-for="stat in stats"
        :key="stat.label"
        class="text-center p-2 rounded-lg bg-slate-50 dark:bg-gray-800"
      >
        <div class="text-lg font-bold text-slate-800 dark:text-white">
          {{ stat.value }}<span class="text-xs text-slate-400">{{ stat.unit }}</span>
        </div>
        <div class="text-[10px] text-slate-400 dark:text-gray-500">{{ stat.label }}</div>
      </div>
    </div>

    <!-- 功能列表 -->
    <div class="space-y-2">
      <div
        v-for="feature in features"
        :key="feature.id"
        class="rounded-xl border border-slate-200 dark:border-gray-700 overflow-hidden transition-all duration-300"
        :class="{ 'ring-2 ring-blue-500/30': expandedSection === feature.id }"
      >
        <!-- 标题栏 -->
        <button
          @click="toggleSection(feature.id)"
          class="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-50 dark:hover:bg-gray-800/50 transition-colors"
        >
          <div
            :class="[
              'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
              colorClasses[feature.color].bg,
            ]"
          >
            <component :is="feature.icon" :size="20" :class="colorClasses[feature.color].text" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-slate-800 dark:text-white">
                {{ feature.title }}
              </span>
            </div>
            <span class="text-xs text-slate-500 dark:text-gray-400">{{ feature.subtitle }}</span>
          </div>
          <ChevronRight
            :size="16"
            class="text-slate-400 transition-transform duration-300"
            :class="{ 'rotate-90': expandedSection === feature.id }"
          />
        </button>

        <!-- 展开内容 -->
        <div
          v-if="expandedSection === feature.id"
          class="px-3 pb-3 space-y-3 animate-fade-in"
        >
          <p class="text-xs text-slate-600 dark:text-gray-300 leading-relaxed">
            {{ feature.description }}
          </p>

          <!-- 技术亮点 -->
          <div class="space-y-1.5">
            <div
              v-for="(highlight, idx) in feature.highlights"
              :key="idx"
              class="flex items-center gap-2 text-xs"
            >
              <CheckCircle2 :size="12" :class="colorClasses[feature.color].text" />
              <span class="text-slate-600 dark:text-gray-300">{{ highlight }}</span>
            </div>
          </div>

          <!-- 技术标签 -->
          <div class="flex flex-wrap gap-1.5 pt-1">
            <span
              v-for="tech in feature.tech"
              :key="tech"
              :class="[
                'px-2 py-0.5 rounded-md text-[10px] font-medium',
                colorClasses[feature.color].highlight,
                colorClasses[feature.color].text,
              ]"
            >
              {{ tech }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部信息 -->
    <div class="pt-3 border-t border-slate-200 dark:border-gray-700">
      <div class="flex items-center justify-between text-[10px] text-slate-400 dark:text-gray-500">
        <span>Vue 3.4 + Vite 5 + Tailwind CSS</span>
        <span>武理小精灵 v1.0</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
