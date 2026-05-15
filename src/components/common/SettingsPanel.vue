<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth.store.js';
import { useThemeStore } from '../../stores/theme.store.js';
import { useLanguageStore } from '../../stores/language.store.js';
import { useToastStore } from '../../stores/toast.store.js';
import { Settings, Moon, Sun, LogOut } from 'lucide-vue-next';

defineProps({ show: Boolean });
const emit = defineEmits(['close']);

const authStore = useAuthStore();
const themeStore = useThemeStore();
const languageStore = useLanguageStore();
const toastStore = useToastStore();
const router = useRouter();

const currentPassword = ref('');
const newPassword = ref('');
const confirmNewPassword = ref('');

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
  emit('close');
};

const handleLogout = () => {
  authStore.logout();
  emit('close');
  router.push('/login');
};
</script>

<template>
  <div
    v-if="show"
    class="settings-panel absolute top-16 mt-2 right-8 z-30 w-80 rounded-xl border border-slate-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm shadow-xl p-4 space-y-4 overflow-y-auto"
    :style="{ maxHeight: 'calc(100vh - 6rem)' }"
  >
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-bold text-slate-800 dark:text-gray-100">系统设置</h3>
      <button
        @click="emit('close')"
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
</template>
