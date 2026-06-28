<script setup>
import { computed, ref, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { useRoute } from 'vue-router';
import { useLanguageStore } from './stores/language.store.js';
import { useAuthStore } from './stores/auth.store.js';
import { FileText, Sparkles, Server } from 'lucide-vue-next';
import Sidebar from './components/layout/Sidebar.vue';
import ToastManager from './components/common/ToastManager.vue';
import ErrorBoundary from './components/common/ErrorBoundary.vue';

// 重面板异步加载，不阻塞首屏渲染
const ProfilePanel = defineAsyncComponent(() => import('./components/common/ProfilePanel.vue'));
const AvatarPicker = defineAsyncComponent(() => import('./components/common/AvatarPicker.vue'));
const PromptPanel = defineAsyncComponent(() => import('./components/chat/PromptPanel.vue'));
const SkillPanel = defineAsyncComponent(() => import('./components/chat/SkillPanel.vue'));
const McpPanel = defineAsyncComponent(() => import('./components/chat/McpPanel.vue'));

const route = useRoute();
const authStore = useAuthStore();
const languageStore = useLanguageStore();
const user = computed(() => authStore.user);
const pageTitle = computed(() => {
  const routeName = String(route.name || 'Dashboard');
  const titleMap = languageStore.tm('app.titles', {});
  return titleMap[routeName] || titleMap.Dashboard || 'Dashboard';
});

const showProfilePanel = ref(false);
const showAvatarPicker = ref(false);
const draftAvatar = ref('');

// 面板状态
const showPromptPanel = ref(false);
const showSkillPanel = ref(false);
const showMcpPanel = ref(false);

const togglePanel = (panel) => {
  const panels = { showPromptPanel, showSkillPanel, showMcpPanel };
  const isOpen = panels[panel].value;
  Object.values(panels).forEach(p => p.value = false);
  panels[panel].value = !isOpen;
};

const openProfilePanel = () => {
  showProfilePanel.value = !showProfilePanel.value;
};

const selectPresetAvatar = (url) => {
  draftAvatar.value = url;
  authStore.updateUser({ avatar: url });
  showAvatarPicker.value = false;
};

const handleClickOutside = (event) => {
  const profilePanel = document.querySelector('.profile-panel');
  const profileBtn = event.target.closest('[title="个人中心"]');

  if (showProfilePanel.value && profilePanel && !profilePanel.contains(event.target) && !profileBtn) {
    showProfilePanel.value = false;
  }

  const isClickOnButton = event.target.closest('button');
  const isClickOnPanel = event.target.closest('.feature-panel');
  if (!isClickOnButton && !isClickOnPanel) {
    showPromptPanel.value = false;
    showSkillPanel.value = false;
    showMcpPanel.value = false;
  }
};

onMounted(() => document.addEventListener('click', handleClickOutside));
onUnmounted(() => document.removeEventListener('click', handleClickOutside));
</script>

<template>
  <div :class="['min-h-screen font-sans transition-colors duration-300 ease-in-out bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-gray-100']">
    <ToastManager />

    <div class="flex h-screen overflow-hidden">
      <Sidebar v-if="route.path !== '/login'" />

      <div class="flex-1 flex flex-col h-screen overflow-hidden relative">
        <header v-if="route.path !== '/login'" class="h-16 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border-b border-slate-200 dark:border-gray-800 shadow-sm flex items-center justify-between px-8 z-10 shrink-0 transition-all duration-300 ease-in-out">
          <h2 class="text-xl font-bold text-slate-800 dark:text-white tracking-tight transition-colors duration-300">
            {{ pageTitle }}
          </h2>

          <div class="flex items-center space-x-3">
            <div class="flex items-center gap-1.5 pr-3 border-r border-slate-200 dark:border-gray-700">
              <button @click="togglePanel('showPromptPanel')" :class="['inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors', showPromptPanel ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'text-slate-500 hover:text-blue-700 dark:text-gray-400 dark:hover:text-blue-300 hover:bg-slate-100 dark:hover:bg-gray-800']" title="提示词">
                <FileText :size="14" />
                <span>提示词</span>
              </button>
              <button @click="togglePanel('showSkillPanel')" :class="['inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors', showSkillPanel ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' : 'text-slate-500 hover:text-violet-700 dark:text-gray-400 dark:hover:text-violet-300 hover:bg-slate-100 dark:hover:bg-gray-800']" title="Skills">
                <Sparkles :size="14" />
                <span>Skills</span>
              </button>
              <button @click="togglePanel('showMcpPanel')" :class="['inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors', showMcpPanel ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'text-slate-500 hover:text-amber-700 dark:text-gray-400 dark:hover:text-amber-300 hover:bg-slate-100 dark:hover:bg-gray-800']" title="MCP">
                <Server :size="14" />
                <span>MCP</span>
              </button>
            </div>

            <button @click="openProfilePanel" class="flex items-center space-x-2 pl-2 border-l border-slate-100 dark:border-gray-700 transition-colors duration-300" title="个人中心">
              <div class="w-8 h-8 rounded-full overflow-hidden ring-2 ring-white dark:ring-gray-700 flex items-center justify-center text-white text-xs font-bold shrink-0">
                <template v-if="user?.avatar">
                  <img :src="user.avatar" alt="" class="w-full h-full object-cover bg-white" />
                </template>
                <template v-else>
                  <div class="w-full h-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                    {{ user?.name?.charAt(0)?.toUpperCase() || 'U' }}
                  </div>
                </template>
              </div>
              <span class="text-sm font-medium text-slate-700 dark:text-gray-200 hidden sm:block transition-colors duration-300">{{ user?.name }}</span>
            </button>
          </div>
        </header>

        <ProfilePanel :show="showProfilePanel" @close="showProfilePanel = false" @open-avatar-picker="showAvatarPicker = true" />

        <main class="flex-1 min-h-0 flex flex-col relative bg-slate-50 dark:bg-gray-950 transition-colors duration-300 ease-in-out">
          <ErrorBoundary>
            <div v-if="showSkillPanel" class="feature-panel absolute top-4 right-4 z-30 w-[420px] max-w-[calc(100%-2rem)]">
              <div class="rounded-2xl border border-slate-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md shadow-xl p-2 overflow-y-auto" style="max-height: calc(100vh - 12rem);"><SkillPanel /></div>
            </div>
            <div v-if="showPromptPanel" class="feature-panel absolute top-4 right-4 z-30 w-[420px] max-w-[calc(100%-2rem)]">
              <div class="rounded-2xl border border-slate-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md shadow-xl p-2 overflow-y-auto" style="max-height: calc(100vh - 12rem);"><PromptPanel /></div>
            </div>
            <div v-if="showMcpPanel" class="feature-panel absolute top-4 right-4 z-30 w-[420px] max-w-[calc(100%-2rem)]">
              <div class="rounded-2xl border border-slate-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md shadow-xl p-2 overflow-y-auto" style="max-height: calc(100vh - 12rem);"><McpPanel /></div>
            </div>

            <router-view v-slot="{ Component }">
              <transition name="fade" mode="out-in">
                <component :is="Component" />
              </transition>
            </router-view>
          </ErrorBoundary>
        </main>
      </div>
    </div>

    <AvatarPicker :show="showAvatarPicker" :current-avatar="draftAvatar" @close="showAvatarPicker = false" @select="selectPresetAvatar" />
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
