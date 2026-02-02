<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from './stores/auth.store.ts';
import Sidebar from './components/layout/Sidebar.vue';

const authStore = useAuthStore();
const route = useRoute();

const isLoginPage = computed(() => route.path === '/login');
const user = computed(() => authStore.user);

</script>

<template>
  <div :class="['min-h-screen font-sans transition-colors duration-300 ease-in-out bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-gray-100']">
    
    <!-- Auth Layout -->
    <div v-if="isLoginPage" class="h-screen w-full">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </div>

    <!-- Main Layout -->
    <div v-else class="flex h-screen overflow-hidden">
      <Sidebar />
      
      <div class="flex-1 flex flex-col h-screen overflow-hidden relative">
        <header class="h-16 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border-b border-slate-200 dark:border-gray-800 shadow-sm flex items-center justify-between px-8 z-10 shrink-0 transition-all duration-300 ease-in-out">
          <h2 class="text-xl font-bold text-slate-800 dark:text-white tracking-tight transition-colors duration-300">
             {{ route.name === 'Home' ? '首页概览' : route.name === 'Todo' ? '任务管理' : route.name === 'Chat' ? 'AI 对话助手' : route.name === 'Settings' ? '系统设置' : route.name === 'About' ? '系统信息' : 'Dashboard' }}
          </h2>
          
          <div class="flex items-center space-x-4">
              <div class="flex items-center space-x-2 pl-2 border-l border-slate-100 dark:border-gray-700 transition-colors duration-300">
                <div class="w-8 h-8 rounded-full bg-slate-200 dark:bg-gray-600 overflow-hidden ring-2 ring-white dark:ring-gray-700">
                  <img :src="user?.avatar" alt="User" class="w-full h-full object-cover" />
                </div>
                <span class="text-sm font-medium text-slate-700 dark:text-gray-200 hidden sm:block transition-colors duration-300">{{ user?.name }}</span>
              </div>
          </div>
        </header>

        <main class="flex-1 overflow-y-auto p-8 relative scroll-smooth bg-slate-50 dark:bg-gray-950 transition-colors duration-300 ease-in-out">
          <router-view v-slot="{ Component }">
             <transition name="fade" mode="out-in">
                <component :is="Component" />
             </transition>
          </router-view>
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
</style>