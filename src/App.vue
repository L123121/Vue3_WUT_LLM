<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import Sidebar from './components/layout/Sidebar.vue';
import MobileSidebar from './components/layout/MobileSidebar.vue';
import ToastManager from './components/common/ToastManager.vue';
import ErrorBoundary from './components/common/ErrorBoundary.vue';

const route = useRoute();

const isMobile = ref(false);
const isMobileSidebarOpen = ref(false);
let mql = null;

onMounted(() => {
  mql = window.matchMedia('(max-width: 768px)');
  isMobile.value = mql.matches;
  mql.addEventListener('change', (e) => { isMobile.value = e.matches; });
});
onUnmounted(() => {
  if (mql) mql.removeEventListener('change', () => {});
});
</script>

<template>
  <div :class="['min-h-screen font-sans transition-colors duration-300 ease-in-out bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-gray-100']">
    <ToastManager />

    <div class="flex h-screen overflow-hidden">
      <Sidebar v-if="route.path !== '/login' && !isMobile" />
      <MobileSidebar v-if="route.path !== '/login' && isMobile" v-model="isMobileSidebarOpen" />

      <div class="flex-1 flex flex-col h-screen overflow-hidden relative">
        <main class="flex-1 min-h-0 flex flex-col relative bg-slate-50 dark:bg-gray-950 transition-colors duration-300 ease-in-out border-t border-b border-slate-200 dark:border-gray-800">
          <ErrorBoundary>
            <router-view v-slot="{ Component }">
              <transition name="fade" mode="out-in">
                <component :is="Component" />
              </transition>
            </router-view>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  </div>

</template>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 移动端 viewport 高度修正 — 使用 dvh 替代 vh */
@media (max-width: 768px) {
  .h-screen {
    height: 100dvh;
  }
}
</style>
