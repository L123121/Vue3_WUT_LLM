<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useRoute } from 'vue-router';
import { useAuthStore } from './stores/auth.store.js';
import { useChatStore } from './stores/chat.store.js';
import { useThemeStore } from './stores/theme.store.js';
import { useLanguageStore } from './stores/language.store.js';
import { useToastStore } from './stores/toast.store.js';
import { fetchUsageStats } from './api/chat.js';
import { Settings, Moon, Sun, LogOut, UserRound, BarChart3, Save, FileText, Sparkles, Server, Gauge, Upload, Image, X } from 'lucide-vue-next';
import Sidebar from './components/layout/Sidebar.vue';
import ToastManager from './components/common/ToastManager.vue';
import PromptPanel from './components/chat/PromptPanel.vue';
import SkillPanel from './components/chat/SkillPanel.vue';
import McpPanel from './components/chat/McpPanel.vue';
import PerformancePanel from './components/chat/PerformancePanel.vue';

const authStore = useAuthStore();
const chatStore = useChatStore();
const themeStore = useThemeStore();
const languageStore = useLanguageStore();
const toastStore = useToastStore();
const route = useRoute();
const router = useRouter();

themeStore.darkMode;
languageStore.locale;

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
const activeProfileTab = ref('profile');
const currentPassword = ref('');
const newPassword = ref('');
const confirmNewPassword = ref('');
const draftName = ref('');
const draftAvatar = ref('');
const remoteUsageData = ref(null);
const usageLoading = ref(false);
const usageLoadError = ref('');
const selectedUsageRange = ref(24);
const hoveredUsagePoint = ref(null);
const usageRangeOptions = [
  { label: '24小时', hours: 24 },
  { label: '7天', hours: 24 * 7 },
  { label: '30天', hours: 24 * 30 },
];

// 预设头像列表
const presetAvatars = [
  'https://api.dicebear.com/7.x/notionists/svg?seed=Felix',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Aneka',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Bailey',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Cleo',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Dusty',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Eden',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Flora',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Grace',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Happy',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Joy',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Bot1',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Bot2',
];

// 面板状态
const showPromptPanel = ref(false);
const showSkillPanel = ref(false);
const showMcpPanel = ref(false);
const showPerformancePanel = ref(false);

// 面板互斥切换
const togglePromptPanel = () => {
  showPromptPanel.value = !showPromptPanel.value;
  if (showPromptPanel.value) {
    showSkillPanel.value = false;
    showMcpPanel.value = false;
    showPerformancePanel.value = false;
  }
};

const toggleSkillPanel = () => {
  showSkillPanel.value = !showSkillPanel.value;
  if (showSkillPanel.value) {
    showPromptPanel.value = false;
    showMcpPanel.value = false;
    showPerformancePanel.value = false;
  }
};

const toggleMcpPanel = () => {
  showMcpPanel.value = !showMcpPanel.value;
  if (showMcpPanel.value) {
    showPromptPanel.value = false;
    showSkillPanel.value = false;
    showPerformancePanel.value = false;
  }
};

const togglePerformancePanel = () => {
  showPerformancePanel.value = !showPerformancePanel.value;
  if (showPerformancePanel.value) {
    showPromptPanel.value = false;
    showSkillPanel.value = false;
    showMcpPanel.value = false;
  }
};

const openSettings = () => {
  showProfilePanel.value = false;
  showSettingsPanel.value = !showSettingsPanel.value;
};

const openProfilePanel = () => {
  showSettingsPanel.value = false;
  showProfilePanel.value = !showProfilePanel.value;
  if (showProfilePanel.value) {
    draftName.value = user.value?.name || '';
    draftAvatar.value = user.value?.avatar || '';
  }
};

const resetPasswordForm = () => {
  currentPassword.value = '';
  newPassword.value = '';
  confirmNewPassword.value = '';
};

const handleChangePassword = () => {
  const settingsText = languageStore.tm('settings');
  if (!currentPassword.value || !newPassword.value || !confirmNewPassword.value) {
    toastStore.error(settingsText.requiredFields || '请填写所有必填项');
    return;
  }

  if (newPassword.value !== confirmNewPassword.value) {
    toastStore.error(settingsText.passwordMismatch || '两次输入的新密码不一致');
    return;
  }

  const result = authStore.changePassword(currentPassword.value, newPassword.value);
  if (!result.success) {
    toastStore.error(result.message);
    return;
  }

  toastStore.success(result.message);
  resetPasswordForm();
  showSettingsPanel.value = false;
};

const handleLogout = () => {
  authStore.logout();
  showSettingsPanel.value = false;
  showProfilePanel.value = false;
  router.push('/login');
};

const estimateTokens = (text) => Math.max(1, Math.ceil(String(text || '').length / 4));
const usageRangeLabel = computed(() => usageRangeOptions.find((item) => item.hours === selectedUsageRange.value)?.label || '24小时');

const localUsageSummary = computed(() => {
  const now = Date.now();
  const from = now - selectedUsageRange.value * 60 * 60 * 1000;
  const allMessages = chatStore.conversations.flatMap((conversation) => conversation.messages || []);
  const recent = allMessages.filter((message) => {
    if (!message || message.id === 'welcome') return false;
    const ts = new Date(message.timestamp).getTime();
    return !Number.isNaN(ts) && ts >= from && ts <= now;
  });

  const inputTokens = recent
    .filter((message) => message.role === 'user')
    .reduce((sum, message) => sum + estimateTokens(message.text), 0);
  const outputTokens = recent
    .filter((message) => message.role === 'model')
    .reduce((sum, message) => sum + estimateTokens(message.text), 0);

  const requestCount = recent.filter((message) => message.role === 'user').length;
  const totalTokens = inputTokens + outputTokens;
  const estimatedCost = (inputTokens / 1000) * 0.002 + (outputTokens / 1000) * 0.006;

  return {
    requestCount,
    inputTokens,
    outputTokens,
    totalTokens,
    cachedTokens: 0,
    estimatedCost,
  };
});

const localUsageTrend = computed(() => {
  const now = new Date();
  const useHourly = selectedUsageRange.value <= 24;
  const bucketMs = useHourly ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const pointCount = useHourly ? selectedUsageRange.value : Math.ceil(selectedUsageRange.value / 24);
  const rangeStart = now.getTime() - selectedUsageRange.value * 60 * 60 * 1000;
  const points = Array.from({ length: pointCount }, (_, index) => {
    const start = new Date(rangeStart + index * bucketMs);
    const label = useHourly
      ? `${String(start.getHours()).padStart(2, '0')}:00`
      : `${String(start.getMonth() + 1).padStart(2, '0')}/${String(start.getDate()).padStart(2, '0')}`;
    return {
      label,
      start: start.getTime(),
      end: start.getTime() + bucketMs,
      tokens: 0,
    };
  });

  const allMessages = chatStore.conversations.flatMap((conversation) => conversation.messages || []);
  allMessages.forEach((message) => {
    if (!message || message.id === 'welcome') return;
    const ts = new Date(message.timestamp).getTime();
    if (Number.isNaN(ts)) return;
    const point = points.find((item) => ts >= item.start && ts < item.end);
    if (point) point.tokens += estimateTokens(message.text);
  });

  const peak = Math.max(...points.map((item) => item.tokens), 1);
  return points.map((item) => ({
    ...item,
    heightPercent: Math.max(6, Math.round((item.tokens / peak) * 100)),
  }));
});

const usageSummary = computed(() => remoteUsageData.value?.summary || localUsageSummary.value);

const usageTrend = computed(() => {
  const source = remoteUsageData.value?.trend?.length
    ? remoteUsageData.value.trend
    : localUsageTrend.value;
  const peak = Math.max(...source.map((item) => item.tokens || 0), 1);
  return source.map((item) => ({
    ...item,
    height: `${Math.max(6, Math.round(((item.tokens || 0) / peak) * 100))}%`,
  }));
});

const usageChartPoints = computed(() => {
  const data = usageTrend.value || [];
  if (!data.length) return [];
  const maxTokens = Math.max(...data.map((item) => item.tokens || 0), 1);
  const denominator = Math.max(data.length - 1, 1);
  return data.map((item, index) => {
    const x = (index / denominator) * 100;
    const ratio = (item.tokens || 0) / maxTokens;
    const y = 100 - ratio * 90;
    return {
      ...item,
      x,
      y,
      value: item.tokens || 0,
    };
  });
});

const usagePolyline = computed(() => usageChartPoints.value.map((point) => `${point.x},${point.y}`).join(' '));

const handlePointHover = (point) => {
  hoveredUsagePoint.value = point;
};

const clearPointHover = () => {
  hoveredUsagePoint.value = null;
};

const loadUsageData = async () => {
  usageLoading.value = true;
  usageLoadError.value = '';
  try {
    const data = await fetchUsageStats(selectedUsageRange.value);
    remoteUsageData.value = data;
  } catch (error) {
    console.warn('Load usage stats failed, fallback to local estimate:', error);
    usageLoadError.value = '后端统计暂不可用，当前展示本地估算值';
    remoteUsageData.value = null;
  } finally {
    usageLoading.value = false;
  }
};

const saveProfile = () => {
  if (!draftName.value.trim()) {
    toastStore.error('用户名不能为空');
    return;
  }

  authStore.updateUser({
    name: draftName.value.trim(),
    avatar: draftAvatar.value.trim() || '',
  });
  toastStore.success('个人信息已更新');
};

// 处理头像上传
const handleAvatarUpload = (event) => {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    toastStore.error('请选择图片文件');
    return;
  }

  if (file.size > 2 * 1024 * 1024) {
    toastStore.error('图片大小不能超过2MB');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    draftAvatar.value = e.target.result;
    toastStore.success('头像已更新，点击保存生效');
  };
  reader.onerror = () => {
    toastStore.error('图片读取失败');
  };
  reader.readAsDataURL(file);
};

// 选择预设头像
const selectPresetAvatar = (url) => {
  draftAvatar.value = url;
  showAvatarPicker.value = false;
};

watch(showProfilePanel, (visible) => {
  if (visible) {
    draftName.value = user.value?.name || '';
    draftAvatar.value = user.value?.avatar || '';
    if (activeProfileTab.value === 'usage') {
      loadUsageData();
    }
  }
});

watch(activeProfileTab, (tab) => {
  if (tab === 'usage' && showProfilePanel.value) {
    loadUsageData();
  }
});

watch(selectedUsageRange, () => {
  if (showProfilePanel.value && activeProfileTab.value === 'usage') {
    loadUsageData();
  }
});

// 点击外部关闭面板
const handleClickOutside = (event) => {
  const settingsPanel = document.querySelector('.settings-panel');
  const profilePanel = document.querySelector('.profile-panel');
  const settingsBtn = event.target.closest('[title="设置"]');
  const profileBtn = event.target.closest('[title="个人中心"]');

  if (showSettingsPanel.value && settingsPanel && !settingsPanel.contains(event.target) && !settingsBtn) {
    showSettingsPanel.value = false;
  }
  if (showProfilePanel.value && profilePanel && !profilePanel.contains(event.target) && !profileBtn) {
    showProfilePanel.value = false;
  }

  // 关闭功能面板（点击面板外部或非按钮区域）
  const isClickOnButton = event.target.closest('button');
  const isClickOnPanel = event.target.closest('.feature-panel');

  if (!isClickOnButton && !isClickOnPanel) {
    showPromptPanel.value = false;
    showSkillPanel.value = false;
    showMcpPanel.value = false;
    showPerformancePanel.value = false;
  }
};

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
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
            <!-- 功能按钮组 -->
            <div class="flex items-center gap-1.5 pr-3 border-r border-slate-200 dark:border-gray-700">
              <button
                @click="togglePromptPanel"
                :class="[
                  'inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors',
                  showPromptPanel
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                    : 'text-slate-500 hover:text-blue-700 dark:text-gray-400 dark:hover:text-blue-300 hover:bg-slate-100 dark:hover:bg-gray-800'
                ]"
                title="提示词"
              >
                <FileText :size="14" />
                <span>提示词</span>
              </button>

              <button
                @click="toggleSkillPanel"
                :class="[
                  'inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors',
                  showSkillPanel
                    ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                    : 'text-slate-500 hover:text-violet-700 dark:text-gray-400 dark:hover:text-violet-300 hover:bg-slate-100 dark:hover:bg-gray-800'
                ]"
                title="Skills"
              >
                <Sparkles :size="14" />
                <span>Skills</span>
              </button>

              <button
                @click="toggleMcpPanel"
                :class="[
                  'inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors',
                  showMcpPanel
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    : 'text-slate-500 hover:text-amber-700 dark:text-gray-400 dark:hover:text-amber-300 hover:bg-slate-100 dark:hover:bg-gray-800'
                ]"
                title="MCP"
              >
                <Server :size="14" />
                <span>MCP</span>
              </button>

              <button
                @click="togglePerformancePanel"
                :class="[
                  'inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors',
                  showPerformancePanel
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                    : 'text-slate-500 hover:text-emerald-700 dark:text-gray-400 dark:hover:text-emerald-300 hover:bg-slate-100 dark:hover:bg-gray-800'
                ]"
                title="性能"
              >
                <Gauge :size="14" />
                <span>性能</span>
              </button>
            </div>

            <button
              @click="openSettings"
              class="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-500 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors"
              title="设置"
            >
              <Settings :size="16" />
            </button>

            <button
              @click="openProfilePanel"
              class="flex items-center space-x-2 pl-2 border-l border-slate-100 dark:border-gray-700 transition-colors duration-300"
              title="个人中心"
            >
              <div class="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 overflow-hidden ring-2 ring-white dark:ring-gray-700 flex items-center justify-center text-white text-xs font-bold">
                {{ user?.name?.charAt(0)?.toUpperCase() || 'U' }}
              </div>
              <span class="text-sm font-medium text-slate-700 dark:text-gray-200 hidden sm:block transition-colors duration-300">{{ user?.name }}</span>
            </button>
          </div>
        </header>

        <div
          v-if="showSettingsPanel"
          class="settings-panel absolute top-16 mt-2 right-8 z-30 w-80 rounded-xl border border-slate-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm shadow-xl p-4 space-y-4 overflow-y-auto"
          :style="{ maxHeight: 'calc(100vh - 6rem)' }"
        >
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-bold text-slate-800 dark:text-gray-100">系统设置</h3>
            <button
              @click="showSettingsPanel = false"
              class="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-gray-200"
            >
              关闭
            </button>
          </div>

          <div class="rounded-lg border border-slate-200 dark:border-gray-700 p-3">
            <div class="text-xs font-semibold text-slate-600 dark:text-gray-300 mb-2">主题模式</div>
            <button
              @click="themeStore.toggleDarkMode()"
              class="w-full h-9 rounded-lg inline-flex items-center justify-center gap-2 text-sm border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800 text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-700 transition-colors"
            >
              <Moon v-if="themeStore.darkMode" :size="14" />
              <Sun v-else :size="14" />
              <span>{{ themeStore.darkMode ? '夜间模式' : '日间模式' }}</span>
            </button>
          </div>

          <div class="rounded-lg border border-slate-200 dark:border-gray-700 p-3 space-y-2.5">
            <div class="text-sm font-bold text-slate-800 dark:text-gray-100">修改密码</div>
            <input
              v-model="currentPassword"
              type="password"
              placeholder="请输入旧密码"
              class="w-full h-10 px-3 text-sm rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <input
              v-model="newPassword"
              type="password"
              placeholder="至少 6 位字符"
              class="w-full h-10 px-3 text-sm rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <input
              v-model="confirmNewPassword"
              type="password"
              placeholder="再次输入新密码"
              class="w-full h-10 px-3 text-sm rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <button
              @click="handleChangePassword"
              class="w-full h-10 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              保存修改
            </button>
          </div>

          <button
            @click="handleLogout"
            class="w-full h-10 rounded-lg inline-flex items-center justify-center gap-2 text-sm font-semibold border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
          >
            <LogOut :size="14" />
            <span>退出登录</span>
          </button>
        </div>

        <div
          v-if="showProfilePanel"
          class="profile-panel absolute top-16 mt-2 right-8 z-30 w-[420px] max-w-[calc(100%-2rem)] rounded-xl border border-slate-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm shadow-xl p-4 overflow-y-auto"
          :style="{ maxHeight: 'calc(100vh - 6rem)' }"
        >
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-bold text-slate-800 dark:text-gray-100">个人中心</h3>
            <button
              @click="showProfilePanel = false"
              class="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-gray-200"
            >关闭</button>
          </div>

          <div class="grid grid-cols-2 gap-2 mb-3">
            <button
              @click="activeProfileTab = 'profile'"
              :class="[
                'h-9 rounded-lg text-sm font-medium border transition-colors inline-flex items-center justify-center gap-1.5',
                activeProfileTab === 'profile'
                  ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/25 dark:border-blue-700 dark:text-blue-300'
                  : 'bg-white border-slate-200 text-slate-600 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300'
              ]"
            >
              <UserRound :size="14" />
              <span>资料编辑</span>
            </button>
            <button
              @click="activeProfileTab = 'usage'"
              :class="[
                'h-9 rounded-lg text-sm font-medium border transition-colors inline-flex items-center justify-center gap-1.5',
                activeProfileTab === 'usage'
                  ? 'bg-violet-50 border-violet-200 text-violet-700 dark:bg-violet-900/25 dark:border-violet-700 dark:text-violet-300'
                  : 'bg-white border-slate-200 text-slate-600 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300'
              ]"
            >
              <BarChart3 :size="14" />
              <span>Token 用量</span>
            </button>
          </div>

          <div v-if="activeProfileTab === 'profile'" class="space-y-3">
            <!-- 头像设置 -->
            <div class="flex items-center gap-4 p-3 rounded-lg bg-slate-50 dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700">
              <div class="w-16 h-16 rounded-full overflow-hidden bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold shrink-0">
                <template v-if="draftAvatar">
                  <img :src="draftAvatar" alt="头像" class="w-full h-full object-cover" @error="draftAvatar = ''" />
                </template>
                <template v-else>
                  {{ (draftName || user?.name)?.charAt(0)?.toUpperCase() || 'U' }}
                </template>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-slate-800 dark:text-gray-100">{{ draftName || user?.name }}</p>
                <p class="text-xs text-slate-500 dark:text-gray-400 mb-2">点击下方按钮更换头像</p>
                <div class="flex gap-2">
                  <label class="cursor-pointer h-7 px-2.5 rounded-md text-xs bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors inline-flex items-center gap-1">
                    <input type="file" accept="image/*" class="hidden" @change="handleAvatarUpload" />
                    <Upload :size="12" />
                    <span>上传图片</span>
                  </label>
                  <button
                    @click="showAvatarPicker = true"
                    class="h-7 px-2.5 rounded-md text-xs border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700 transition-colors inline-flex items-center gap-1"
                  >
                    <Image :size="12" />
                    <span>选择头像</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- 头像链接输入 -->
            <div>
              <label class="block text-xs font-semibold text-slate-700 dark:text-gray-300 mb-1">头像链接</label>
              <input
                v-model="draftAvatar"
                type="text"
                class="w-full h-9 px-3 text-sm rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                placeholder="输入图片URL或留空使用默认头像"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-700 dark:text-gray-300 mb-1">用户名</label>
              <input
                v-model="draftName"
                type="text"
                class="w-full h-9 px-3 text-sm rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                placeholder="请输入用户名"
              />
            </div>
            <button
              @click="saveProfile"
              class="w-full h-9 rounded-lg inline-flex items-center justify-center gap-2 text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 transition-colors"
            >
              <Save :size="14" />
              <span>保存资料</span>
            </button>
          </div>

          <div v-else class="space-y-3">
            <div v-if="usageLoadError" class="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2">
              {{ usageLoadError }}
            </div>

            <div class="flex items-center gap-2">
              <button
                v-for="option in usageRangeOptions"
                :key="option.hours"
                @click="selectedUsageRange = option.hours"
                :class="[
                  'h-8 px-3 rounded-lg text-xs border transition-colors',
                  selectedUsageRange === option.hours
                    ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/25 dark:border-blue-700 dark:text-blue-300'
                    : 'bg-white border-slate-200 text-slate-500 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300'
                ]"
              >
                {{ option.label }}
              </button>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div class="rounded-lg border border-slate-200 dark:border-gray-700 p-3 bg-slate-50 dark:bg-gray-800/60">
                <p class="text-xs text-slate-500 dark:text-gray-400">总请求数</p>
                <p class="mt-1 text-xl font-bold text-slate-900 dark:text-white">{{ usageSummary.requestCount }}</p>
              </div>
              <div class="rounded-lg border border-slate-200 dark:border-gray-700 p-3 bg-slate-50 dark:bg-gray-800/60">
                <p class="text-xs text-slate-500 dark:text-gray-400">总 Token</p>
                <p class="mt-1 text-xl font-bold text-slate-900 dark:text-white">{{ usageSummary.totalTokens }}</p>
              </div>
              <div class="rounded-lg border border-slate-200 dark:border-gray-700 p-3 bg-slate-50 dark:bg-gray-800/60">
                <p class="text-xs text-slate-500 dark:text-gray-400">输入 / 输出</p>
                <p class="mt-1 text-sm font-bold text-slate-900 dark:text-white">{{ usageSummary.inputTokens }} / {{ usageSummary.outputTokens }}</p>
              </div>
              <div class="rounded-lg border border-slate-200 dark:border-gray-700 p-3 bg-slate-50 dark:bg-gray-800/60">
                <p class="text-xs text-slate-500 dark:text-gray-400">估算成本</p>
                <p class="mt-1 text-xl font-bold text-slate-900 dark:text-white">${{ usageSummary.estimatedCost.toFixed(4) }}</p>
              </div>
            </div>

            <div class="rounded-lg border border-slate-200 dark:border-gray-700 p-3">
              <div class="flex items-center justify-between mb-2">
                <p class="text-xs font-semibold text-slate-700 dark:text-gray-300">近{{ usageRangeLabel }}用量趋势</p>
                <button
                  @click="loadUsageData"
                  class="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                >刷新</button>
              </div>
              <div v-if="usageLoading" class="h-32 flex items-center justify-center text-xs text-slate-500 dark:text-gray-400">
                加载中...
              </div>
              <div v-else class="relative h-32" @mouseleave="clearPointHover">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="w-full h-full">
                  <polyline
                    :points="usagePolyline"
                    fill="none"
                    stroke="currentColor"
                    class="text-blue-500"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <circle
                    v-for="point in usageChartPoints"
                    :key="point.label"
                    :cx="point.x"
                    :cy="point.y"
                    r="2.2"
                    class="fill-violet-500 cursor-pointer"
                    @mouseenter="handlePointHover(point)"
                  />
                </svg>
                <div
                  v-if="hoveredUsagePoint"
                  class="absolute -top-8 px-2 py-1 rounded-md text-[10px] whitespace-nowrap bg-slate-900 text-white shadow"
                  :style="{ left: `calc(${hoveredUsagePoint.x}% - 28px)` }"
                >
                  {{ hoveredUsagePoint.label }} · {{ hoveredUsagePoint.value }} tokens
                </div>
              </div>
              <div class="mt-2 flex justify-between text-[10px] text-slate-400 dark:text-gray-500">
                <span>{{ usageTrend[0]?.label }}</span>
                <span>{{ usageTrend[usageTrend.length - 1]?.label }}</span>
              </div>
            </div>
          </div>
        </div>

        <main class="flex-1 min-h-0 flex flex-col relative bg-slate-50 dark:bg-gray-950 transition-colors duration-300 ease-in-out">
          <!-- 功能面板 -->
          <div v-if="showSkillPanel" class="feature-panel absolute top-4 right-4 z-30 w-[420px] max-w-[calc(100%-2rem)]">
            <div class="rounded-2xl border border-slate-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md shadow-xl p-2 overflow-y-auto" style="max-height: calc(100vh - 12rem);">
              <SkillPanel />
            </div>
          </div>

          <div v-if="showPromptPanel" class="feature-panel absolute top-4 right-4 z-30 w-[420px] max-w-[calc(100%-2rem)]">
            <div class="rounded-2xl border border-slate-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md shadow-xl p-2 overflow-y-auto" style="max-height: calc(100vh - 12rem);">
              <PromptPanel />
            </div>
          </div>

          <div v-if="showMcpPanel" class="feature-panel absolute top-4 right-4 z-30 w-[420px] max-w-[calc(100%-2rem)]">
            <div class="rounded-2xl border border-slate-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md shadow-xl p-2 overflow-y-auto" style="max-height: calc(100vh - 12rem);">
              <McpPanel />
            </div>
          </div>

          <div v-if="showPerformancePanel" class="feature-panel absolute top-4 right-4 z-30 w-[420px] max-w-[calc(100%-2rem)]">
            <div class="rounded-2xl border border-slate-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md shadow-xl p-2 overflow-y-auto" style="max-height: calc(100vh - 12rem);">
              <PerformancePanel />
            </div>
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

    <!-- 头像选择器模态框 -->
    <div
      v-if="showAvatarPicker"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      @click.self="showAvatarPicker = false"
    >
      <div class="w-full max-w-sm mx-4 rounded-2xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl p-4">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-sm font-bold text-slate-800 dark:text-white">选择头像</h3>
          <button
            @click="showAvatarPicker = false"
            class="w-7 h-7 rounded-lg inline-flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X :size="14" />
          </button>
        </div>
        <div class="grid grid-cols-4 gap-2">
          <button
            v-for="(avatar, index) in presetAvatars"
            :key="index"
            @click="selectPresetAvatar(avatar)"
            class="w-full aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-violet-400 dark:hover:border-violet-500 transition-colors"
            :class="{ 'border-violet-500': draftAvatar === avatar }"
          >
            <img :src="avatar" alt="头像" class="w-full h-full object-cover bg-slate-100 dark:bg-gray-800" />
          </button>
        </div>
        <p class="mt-3 text-[10px] text-slate-400 dark:text-gray-500 text-center">点击选择预设头像</p>
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
