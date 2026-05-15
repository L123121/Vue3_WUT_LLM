<script setup>
import { AlertTriangle, X } from 'lucide-vue-next';

const props = defineProps({
  show: Boolean,
  title: { type: String, default: '确认操作' },
  message: { type: String, default: '确定要执行此操作吗？' },
  confirmText: { type: String, default: '确认' },
  cancelText: { type: String, default: '取消' },
  danger: { type: Boolean, default: false }
});

const emit = defineEmits(['confirm', 'cancel']);
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="show"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
        @click.self="emit('cancel')"
      >
        <div class="w-[90%] max-w-sm bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-slate-200 dark:border-gray-700 p-4 transform transition-all">
          <div class="flex items-center gap-3 mb-3">
            <div
              :class="[
                'w-10 h-10 rounded-full flex items-center justify-center shrink-0',
                danger
                  ? 'bg-red-100 dark:bg-red-900/30'
                  : 'bg-blue-100 dark:bg-blue-900/30'
              ]"
            >
              <AlertTriangle
                :size="20"
                :class="danger ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'"
              />
            </div>
            <div class="min-w-0">
              <h3 class="text-sm font-bold text-slate-800 dark:text-white">{{ title }}</h3>
              <p class="text-xs text-slate-500 dark:text-gray-400 truncate">{{ message }}</p>
            </div>
          </div>

          <div class="flex justify-end gap-2 mt-4">
            <button
              @click="emit('cancel')"
              class="px-3 py-1.5 rounded-lg text-xs text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
            >
              {{ cancelText }}
            </button>
            <button
              @click="emit('confirm')"
              :class="[
                'px-3 py-1.5 rounded-lg text-xs text-white transition-colors',
                danger
                  ? 'bg-red-500 hover:bg-red-600'
                  : 'bg-blue-500 hover:bg-blue-600'
              ]"
            >
              {{ confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
