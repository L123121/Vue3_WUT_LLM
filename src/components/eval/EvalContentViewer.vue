<script setup>
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';

const props = defineProps({
  currentItem: { type: Object, required: true },
  currentIndex: { type: Number, required: true },
  totalItems: { type: Number, required: true },
  humanScores: { type: Object, required: true },
  comments: { type: Object, required: true },
  getScoreLabel: { type: Function, required: true },
  getScoreColor: { type: Function, required: true },
  getScoreBg: { type: Function, required: true },
});

const emit = defineEmits(['setScore', 'prev', 'next']);

function getScoreColor(score) {
  if (score >= 0.8) return 'text-green-600';
  if (score >= 0.6) return 'text-yellow-600';
  if (score >= 0.4) return 'text-orange-600';
  return 'text-red-600';
}

function getScoreBg(score) {
  if (score >= 0.8) return 'bg-green-50 dark:bg-green-900/20';
  if (score >= 0.6) return 'bg-yellow-50 dark:bg-yellow-900/20';
  if (score >= 0.4) return 'bg-orange-50 dark:bg-orange-900/20';
  return 'bg-red-50 dark:bg-red-900/20';
}
</script>

<template>
  <div class="max-w-5xl mx-auto">
    <!-- 进度条 -->
    <div class="mb-4 flex items-center gap-4">
      <span class="text-sm text-gray-500">{{ currentIndex + 1 }} / {{ totalItems }}</span>
      <div class="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div class="h-full bg-blue-500 transition-all" :style="{ width: ((currentIndex + 1) / totalItems * 100) + '%' }"></div>
      </div>
      <span class="text-sm text-gray-500">已打分: {{ Object.keys(humanScores).length }}</span>
    </div>

    <!-- 导航 -->
    <div class="flex items-center justify-between mb-4">
      <button @click="$emit('prev')" :disabled="currentIndex === 0"
        class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-200 dark:bg-gray-700 disabled:opacity-30 hover:bg-gray-300 dark:hover:bg-gray-600 transition">
        <ChevronLeft :size="16" /> 上一条
      </button>
      <div class="flex items-center gap-2">
        <span class="px-2 py-0.5 rounded text-xs" :class="{
          'bg-green-100 text-green-700': currentItem.difficulty === 'easy',
          'bg-yellow-100 text-yellow-700': currentItem.difficulty === 'medium',
          'bg-red-100 text-red-700': currentItem.difficulty === 'hard'
        }">{{ currentItem.difficulty }}</span>
        <span class="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">{{ currentItem.category }}</span>
        <span class="text-xs text-gray-400">{{ currentItem.id }}</span>
      </div>
      <button @click="$emit('next')" :disabled="currentIndex >= totalItems - 1"
        class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-200 dark:bg-gray-700 disabled:opacity-30 hover:bg-gray-300 dark:hover:bg-gray-600 transition">
        下一条 <ChevronRight :size="16" />
      </button>
    </div>

    <!-- 问题 -->
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow p-5 mb-4">
      <h3 class="text-sm font-semibold text-gray-500 mb-2">问题</h3>
      <p class="text-lg text-gray-800 dark:text-white">{{ currentItem.question }}</p>
    </div>

    <!-- AI 回答 -->
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow p-5 mb-4">
      <h3 class="text-sm font-semibold text-gray-500 mb-2">AI 回答</h3>
      <p class="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{{ currentItem.answer || '（无回答）' }}</p>
    </div>

    <!-- 标准答案 -->
    <div v-if="currentItem.ground_truth" class="bg-green-50 dark:bg-green-900/20 rounded-xl shadow p-5 mb-4">
      <h3 class="text-sm font-semibold text-green-600 mb-2">标准答案</h3>
      <p class="text-gray-700 dark:text-gray-300">{{ currentItem.ground_truth }}</p>
    </div>

    <!-- RAGAS 自动评分 -->
    <div v-if="currentItem.metrics" class="bg-white dark:bg-gray-800 rounded-xl shadow p-5 mb-4">
      <h3 class="text-sm font-semibold text-gray-500 mb-3">RAGAS 自动评分</h3>
      <div class="grid grid-cols-5 gap-3">
        <div class="text-center p-2 rounded-lg" :class="getScoreBg(currentItem.metrics.faithfulness)">
          <div class="text-lg font-bold" :class="getScoreColor(currentItem.metrics.faithfulness)">
            {{ (currentItem.metrics.faithfulness * 100).toFixed(0) }}%
          </div>
          <div class="text-xs text-gray-500">忠实度</div>
        </div>
        <div class="text-center p-2 rounded-lg" :class="getScoreBg(currentItem.metrics.answer_relevancy)">
          <div class="text-lg font-bold" :class="getScoreColor(currentItem.metrics.answer_relevancy)">
            {{ (currentItem.metrics.answer_relevancy * 100).toFixed(0) }}%
          </div>
          <div class="text-xs text-gray-500">相关性</div>
        </div>
        <div class="text-center p-2 rounded-lg" :class="getScoreBg(currentItem.metrics.context_precision)">
          <div class="text-lg font-bold" :class="getScoreColor(currentItem.metrics.context_precision)">
            {{ (currentItem.metrics.context_precision * 100).toFixed(0) }}%
          </div>
          <div class="text-xs text-gray-500">精确度</div>
        </div>
        <div class="text-center p-2 rounded-lg" :class="getScoreBg(currentItem.metrics.context_recall)">
          <div class="text-lg font-bold" :class="getScoreColor(currentItem.metrics.context_recall)">
            {{ (currentItem.metrics.context_recall * 100).toFixed(0) }}%
          </div>
          <div class="text-xs text-gray-500">召回率</div>
        </div>
        <div class="text-center p-2 rounded-lg" :class="getScoreBg(currentItem.metrics.overall)">
          <div class="text-lg font-bold" :class="getScoreColor(currentItem.metrics.overall)">
            {{ (currentItem.metrics.overall * 100).toFixed(0) }}%
          </div>
          <div class="text-xs text-gray-500">综合</div>
        </div>
      </div>
    </div>

    <!-- 检索来源 -->
    <div v-if="currentItem.contexts?.length" class="bg-white dark:bg-gray-800 rounded-xl shadow p-5 mb-4">
      <h3 class="text-sm font-semibold text-gray-500 mb-2">检索到的上下文 ({{ currentItem.contexts.length }} 条)</h3>
      <div class="space-y-2 max-h-48 overflow-y-auto">
        <div v-for="(ctx, idx) in currentItem.contexts" :key="idx"
          class="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-sm text-gray-600 dark:text-gray-300">
          <span class="text-xs text-gray-400 mr-2">[{{ idx + 1 }}]</span>
          {{ ctx }}
        </div>
      </div>
    </div>

    <!-- 人工打分 -->
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow p-5 mb-4">
      <h3 class="text-sm font-semibold text-gray-500 mb-3">人工打分（1-5 分）</h3>
      <div class="flex items-center gap-4 mb-4">
        <div class="flex gap-2">
          <button v-for="score in 5" :key="score" @click="$emit('setScore', currentItem.id, score)"
            class="w-12 h-12 rounded-xl text-lg font-bold transition-all"
            :class="humanScores[currentItem.id] === score
              ? 'bg-yellow-400 text-white shadow-lg scale-110'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-yellow-100 dark:hover:bg-yellow-900/30'">
            {{ score }}
          </button>
        </div>
        <div class="flex-1 text-sm text-gray-500">
          <span v-if="!humanScores[currentItem.id]">请打分（或按键盘 1-5）</span>
          <span v-else class="text-yellow-600 font-semibold">
            当前: {{ humanScores[currentItem.id] }} 分 {{ getScoreLabel(humanScores[currentItem.id]) }}
          </span>
        </div>
      </div>
      <textarea v-model="comments[currentItem.id]"
        class="w-full p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-sm resize-none"
        rows="2" placeholder="评语（可选）..."></textarea>
    </div>

    <!-- 快捷操作 -->
    <div class="flex items-center justify-between">
      <button @click="$emit('prev')" :disabled="currentIndex === 0"
        class="flex items-center gap-1 px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 disabled:opacity-30 hover:bg-gray-300 dark:hover:bg-gray-600 transition">
        <ChevronLeft :size="16" /> 上一条
      </button>
      <div class="flex gap-2">
        <button v-if="humanScores[currentItem.id]" @click="$emit('next')"
          class="flex items-center gap-1 px-6 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
          打分并下一条 <ChevronRight :size="16" />
        </button>
      </div>
      <button @click="$emit('next')" :disabled="currentIndex >= totalItems - 1"
        class="flex items-center gap-1 px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 disabled:opacity-30 hover:bg-gray-300 dark:hover:bg-gray-600 transition">
        下一条 <ChevronRight :size="16" />
      </button>
    </div>
  </div>
</template>
