<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useRoute } from 'vue-router';
import { useAuthStore } from './stores/auth.store.js';
import { useThemeStore } from './stores/theme.store.js';
import { useLanguageStore } from './stores/language.store.js';
import { Settings, FileText, Sparkles, Server, Gauge } from 'lucide-vue-next';
import Sidebar from './components/layout/Sidebar.vue';
import ToastManager from './components/common/ToastManager.vue';
import SettingsPanel from './components/common/SettingsPanel.vue';
import ProfilePanel from './components/common/ProfilePanel.vue';
import AvatarPicker from './components/common/AvatarPicker.vue';
import PromptPanel from './components/chat/PromptPanel.vue';
import SkillPanel from './components/chat/SkillPanel.vue';
import McpPanel from './components/chat/McpPanel.vue';
import PerformancePanel from './components/chat/PerformancePanel.vue';

const authStore = useAuthStore();
const themeStore = useThemeStore();
const languageStore = useLanguageStore();
const route = useRoute();
const router = useRouter();

const isLoginPage = computed(() => route.path === '/login');
const user = computed(() => authStore.user);
const pageTitle = computed(() => {
  const routeName = String(route.name || 'Dashboard');
  const titleMap = languageStore.tm('app.titles', {});
  return titleMap[routeName] || titleMap.Dashboard || 'Dashboard';
});

const showSettingsPanel = ref(false);
const showProfilePanel = ref(false);
const showAvatarPicker = ref(false);
const draftAvatar = ref('');

// 面板状态
const showPromptPanel = ref(false);
const showSkillPanel = ref(false);
const showMcpPanel = ref(false);
const showPerformancePanel = ref(false);

const togglePanel = (panel) => {
  const panels = { showPromptPanel, showSkillPanel, showMcpPanel, showPerformancePanel };
  const isOpen = panels[panel].value;
  Object.values(panels).forEach(p => p.value = false);
  panels[panel].value = !isOpen;
};

const openSettings = () => {
  showProfilePanel.value = false;
  showSettingsPanel.value = !showSettingsPanel.value;
};

const openProfilePanel = () => {
  showSettingsPanel.value = false;
  showProfilePanel.value = !showProfilePanel.value;
};

const selectPresetAvatar = (url) => {
  draftAvatar.value = url;
  showAvatarPicker.value = false;
};

const handleClickOutside = (event) => {
  const profilePanel = document.querySelector('.profile-panel');
  const profileBtn = event.target.closest('[title="个人中心"]');
  const settingsBtn = event.target.closest('[title="设置"]');

  if (showSettingsPanel.value && !event.target.closest('.settings-panel') && !settingsBtn) {
    showSettingsPanel.value = false;
  }
  if (showProfilePanel.value && profilePanel && !profilePanel.contains(event.target) && !profileBtn) {
    showProfilePanel.value = false;
  }

  const isClickOnButton = event.target.closest('button');
  const isClickOnPanel = event.target.closest('.feature-panel');
  if (!isClickOnButton && !isClickOnPanel) {
    showPromptPanel.value = false;
    showSkillPanel.value = false;
    showMcpPanel.value = false;
    showPerformancePanel.value = false;
  }
};

onMounted(() => document.addEventListener('click', handleClickOutside));
onUnmounted(() => document.removeEventListener('click', handleClickOutside));
</script>

<template>
  <div :class="['min-h-screen font-sans transition-colors duration-300 ease-in-out bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-gray-100']">
    <ToastManager />
    <div v-if="isLoginPage" class="h-screen w-full">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </div>

    <div v-else class="flex h-screen overflow-hidden">
      <Sidebar />

      <div class="flex-1 flex flex-col h-screen overflow-hidden relative">
        <header class="h-16 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border-b border-slate-200 dark:border-gray-800 shadow-sm flex items-center justify-between px-8 z-10 shrink-0 transition-all duration-300 ease-in-out">
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
              <button @click="togglePanel('showPerformancePanel')" :class="['inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors', showPerformancePanel ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'text-slate-500 hover:text-emerald-700 dark:text-gray-400 dark:hover:text-emerald-300 hover:bg-slate-100 dark:hover:bg-gray-800']" title="性能">
                <Gauge :size="14" />
                <span>性能</span>
              </button>
            </div>

            <button @click="openSettings" class="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-500 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors" title="设置">
              <Settings :size="16" />
            </button>

            <button @click="openProfilePanel" class="flex items-center space-x-2 pl-2 border-l border-slate-100 dark:border-gray-700 transition-colors duration-300" title="个人中心">
              <div class="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 overflow-hidden ring-2 ring-white dark:ring-gray-700 flex items-center justify-center text-white text-xs font-bold">
                {{ user?.name?.charAt(0)?.toUpperCase() || 'U' }}
              </div>
              <span class="text-sm font-medium text-slate-700 dark:text-gray-200 hidden sm:block transition-colors duration-300">{{ user?.name }}</span>
            </button>
          </div>
        </header>

        <SettingsPanel :show="showSettingsPanel" @close="showSettingsPanel = false" />
        <ProfilePanel :show="showProfilePanel" :avatar-url="draftAvatar" :user-name="user?.name || ''" @close="showProfilePanel = false" @open-avatar-picker="showAvatarPicker = true" />

        <main class="flex-1 min-h-0 flex flex-col relative bg-slate-50 dark:bg-gray-950 transition-colors duration-300 ease-in-out">
          <div v-if="showSkillPanel" class="feature-panel absolute top-4 right-4 z-30 w-[420px] max-w-[calc(100%-2rem)]">
            <div class="rounded-2xl border border-slate-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md shadow-xl p-2 overflow-y-auto" style="max-height: calc(100vh - 12rem);"><SkillPanel /></div>
          </div>
          <div v-if="showPromptPanel" class="feature-panel absolute top-4 right-4 z-30 w-[420px] max-w-[calc(100%-2rem)]">
            <div class="rounded-2xl border border-slate-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md shadow-xl p-2 overflow-y-auto" style="max-height: calc(100vh - 12rem);"><PromptPanel /></div>
          </div>
          <div v-if="showMcpPanel" class="feature-panel absolute top-4 right-4 z-30 w-[420px] max-w-[calc(100%-2rem)]">
            <div class="rounded-2xl border border-slate-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md shadow-xl p-2 overflow-y-auto" style="max-height: calc(100vh - 12rem);"><McpPanel /></div>
          </div>
          <div v-if="showPerformancePanel" class="feature-panel absolute top-4 right-4 z-30 w-[420px] max-w-[calc(100%-2rem)]">
            <div class="rounded-2xl border border-slate-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md shadow-xl p-2 overflow-y-auto" style="max-height: calc(100vh - 12rem);"><PerformancePanel /></div>
          </div>

          <router-view v-slot="{ Component }">
            <transition name="fade" mode="out-in">
              <Suspense>
                <template #default>
                  <component :is="Component" />
                </template>
                <template #fallback>
                  <div class="flex items-center justify-center h-64">
                    <div class="flex flex-col items-center space-y-4">
                      <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
                      <span class="text-sm text-slate-500 dark:text-gray-400">{{ languageStore.t('app.loading') }}</span>
                    </div>
                  </div>
                </template>
              </Suspense>
            </transition>
          </router-view>
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
