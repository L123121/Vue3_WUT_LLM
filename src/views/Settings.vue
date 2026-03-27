<script setup>
import { ref, computed } from 'vue';
import { useAuthStore } from '../stores/auth.store.js';
import { useThemeStore } from '../stores/theme.store.js';
import { useNotificationStore } from '../stores/notification.store.js';
import { useLanguageStore } from '../stores/language.store.js';
import { Moon, Globe, Shield, ChevronRight, Mail, X, Loader2, Check, AlertCircle, Lock, MessageSquare, Info } from 'lucide-vue-next';

const authStore = useAuthStore();
const themeStore = useThemeStore();
const notificationStore = useNotificationStore();
const languageStore = useLanguageStore();

const user = computed(() => authStore.user || {});
const darkMode = computed(() => themeStore.darkMode);
const currentLanguageLabel = computed(() => languageStore.currentLanguage.label);
const languageOptions = computed(() => languageStore.languageOptions);
const text = computed(() => languageStore.tm('settings'));

const email = ref('student@whut.edu.cn');
const activeModal = ref('none');
const isLoading = ref(false);
const feedback = ref(null);
const tempEmail = ref('');
const selectedLanguage = ref(languageStore.locale);
const passwordForm = ref({ old: '', new: '', confirm: '' });
const profileForm = ref({ name: '', college: '', grade: '' });

const resetForm = () => {
  tempEmail.value = '';
  selectedLanguage.value = languageStore.locale;
  passwordForm.value = { old: '', new: '', confirm: '' };
  profileForm.value = { name: '', college: '', grade: '' };
  feedback.value = null;
  isLoading.value = false;
};

const openModal = (type) => {
  resetForm();
  if (type === 'email') tempEmail.value = email.value;
  if (type === 'language') selectedLanguage.value = languageStore.locale;
  if (type === 'profile') {
    profileForm.value = {
      name: user.value.name || '',
      college: user.value.college || '',
      grade: user.value.grade || '',
    };
  }
  activeModal.value = type;
};

const closeModal = () => {
  activeModal.value = 'none';
  resetForm();
};

const handleSaveEmail = () => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(tempEmail.value)) {
    feedback.value = { type: 'error', text: text.value.invalidEmail };
    return;
  }
  isLoading.value = true;
  setTimeout(() => {
    email.value = tempEmail.value;
    isLoading.value = false;
    feedback.value = { type: 'success', text: text.value.emailSaved };
    setTimeout(closeModal, 1200);
  }, 800);
};

const handleSavePassword = () => {
  const { old, new: newPass, confirm } = passwordForm.value;
  if (!old || !newPass || !confirm) return feedback.value = { type: 'error', text: text.value.requiredFields };
  if (newPass.length < 6) return feedback.value = { type: 'error', text: text.value.passwordTooShort };
  if (newPass !== confirm) return feedback.value = { type: 'error', text: text.value.passwordMismatch };
  if (old !== '123456') return feedback.value = { type: 'error', text: text.value.oldPasswordWrong };
  isLoading.value = true;
  setTimeout(() => {
    isLoading.value = false;
    feedback.value = { type: 'success', text: text.value.passwordSaved };
    setTimeout(closeModal, 1200);
  }, 800);
};

const handleSaveProfile = () => {
  if (!profileForm.value.name) return feedback.value = { type: 'error', text: text.value.nicknameRequired };
  isLoading.value = true;
  setTimeout(() => {
    authStore.updateUser(profileForm.value);
    isLoading.value = false;
    feedback.value = { type: 'success', text: text.value.profileSaved };
    setTimeout(closeModal, 1200);
  }, 800);
};

const handleSaveLanguage = () => {
  isLoading.value = true;
  setTimeout(() => {
    languageStore.setLocale(selectedLanguage.value);
    isLoading.value = false;
    feedback.value = { type: 'success', text: text.value.languageSaved };
    setTimeout(closeModal, 600);
  }, 300);
};

const handleSave = () => {
  if (activeModal.value === 'email') return handleSaveEmail();
  if (activeModal.value === 'profile') return handleSaveProfile();
  if (activeModal.value === 'language') return handleSaveLanguage();
  return handleSavePassword();
};

const modalTitle = computed(() => {
  if (activeModal.value === 'email') return text.value.emailModal;
  if (activeModal.value === 'profile') return text.value.profileModal;
  if (activeModal.value === 'language') return text.value.languageModal;
  return text.value.passwordModal;
});
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6 animate-fade-in relative">
    <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-gray-700 flex items-center transition-colors">
      <div class="w-20 h-20 rounded-full bg-slate-100 dark:bg-gray-700 overflow-hidden ring-4 ring-slate-50 dark:ring-gray-700 shrink-0">
        <img :src="user.avatar" :alt="user.name" class="w-full h-full object-cover" />
      </div>
      <div class="ml-6 flex-1">
        <h2 class="text-xl font-bold text-slate-800 dark:text-white">{{ user.name }}</h2>
        <p class="text-slate-500 dark:text-gray-400 text-sm">{{ user.college || text.placeholderCollege }} · {{ user.grade || text.placeholderGrade }}</p>
        <div class="mt-3 flex space-x-3">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            {{ text.studentId }}: {{ user.id === 'u1' ? '01220230101' : user.id }}
          </span>
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
            {{ text.status }}
          </span>
        </div>
      </div>
      <button @click="openModal('profile')" class="hidden sm:block px-4 py-2 border border-slate-200 dark:border-gray-600 rounded-lg text-sm text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors">
        {{ text.editProfile }}
      </button>
    </div>

    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-slate-100 dark:border-gray-700 overflow-hidden transition-colors">
      <div class="p-4 border-b border-slate-100 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-800">
        <h3 class="font-semibold text-slate-700 dark:text-gray-400 text-sm uppercase tracking-wider">{{ text.preferenceTitle }}</h3>
      </div>
      <div class="divide-y divide-slate-100 dark:divide-gray-700">
        <div class="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors">
          <div class="flex items-center"><div class="p-2 bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400 rounded-lg mr-4"><Info :size="20" /></div><div><p class="font-medium text-slate-800 dark:text-white">{{ text.systemNotifications }}</p><p class="text-xs text-slate-500 dark:text-gray-400">{{ text.systemNotificationsDesc }}</p></div></div>
          <button @click="notificationStore.togglePreference('system')" :class="['w-11 h-6 rounded-full transition-colors relative', notificationStore.preferences.system ? 'bg-green-600' : 'bg-slate-300 dark:bg-gray-600']"><span :class="['absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform', notificationStore.preferences.system ? 'translate-x-5' : 'translate-x-0']" /></button>
        </div>
        <div class="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors">
          <div class="flex items-center"><div class="p-2 bg-green-50 dark:bg-gray-700 text-green-600 dark:text-green-400 rounded-lg mr-4"><MessageSquare :size="20" /></div><div><p class="font-medium text-slate-800 dark:text-white">{{ text.messageNotifications }}</p><p class="text-xs text-slate-500 dark:text-gray-400">{{ text.messageNotificationsDesc }}</p></div></div>
          <button @click="notificationStore.togglePreference('message')" :class="['w-11 h-6 rounded-full transition-colors relative', notificationStore.preferences.message ? 'bg-green-600' : 'bg-slate-300 dark:bg-gray-600']"><span :class="['absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform', notificationStore.preferences.message ? 'translate-x-5' : 'translate-x-0']" /></button>
        </div>
        <div class="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors">
          <div class="flex items-center"><div class="p-2 bg-orange-50 dark:bg-gray-700 text-orange-600 dark:text-orange-400 rounded-lg mr-4"><AlertCircle :size="20" /></div><div><p class="font-medium text-slate-800 dark:text-white">{{ text.alertNotifications }}</p><p class="text-xs text-slate-500 dark:text-gray-400">{{ text.alertNotificationsDesc }}</p></div></div>
          <button @click="notificationStore.togglePreference('alert')" :class="['w-11 h-6 rounded-full transition-colors relative', notificationStore.preferences.alert ? 'bg-green-600' : 'bg-slate-300 dark:bg-gray-600']"><span :class="['absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform', notificationStore.preferences.alert ? 'translate-x-5' : 'translate-x-0']" /></button>
        </div>
        <div class="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors">
          <div class="flex items-center"><div class="p-2 bg-purple-50 dark:bg-gray-700 text-purple-600 dark:text-purple-400 rounded-lg mr-4"><Moon :size="20" /></div><div><p class="font-medium text-slate-800 dark:text-white">{{ text.darkMode }}</p><p class="text-xs text-slate-500 dark:text-gray-400">{{ text.darkModeDesc }}</p></div></div>
          <button @click="themeStore.toggleDarkMode()" :class="['w-11 h-6 rounded-full transition-colors relative', darkMode ? 'bg-green-600' : 'bg-slate-300 dark:bg-gray-600']"><span :class="['absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform', darkMode ? 'translate-x-5' : 'translate-x-0']" /></button>
        </div>
        <div @click="openModal('language')" class="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors cursor-pointer">
          <div class="flex items-center"><div class="p-2 bg-emerald-50 dark:bg-gray-700 text-emerald-600 dark:text-emerald-400 rounded-lg mr-4"><Globe :size="20" /></div><div><p class="font-medium text-slate-800 dark:text-white">{{ text.language }}</p><p class="text-xs text-slate-500 dark:text-gray-400">{{ text.current }}: {{ currentLanguageLabel }} · {{ text.languageDesc }}</p></div></div>
          <ChevronRight :size="18" class="text-slate-400 dark:text-gray-600" />
        </div>
      </div>
    </div>

    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-slate-100 dark:border-gray-700 overflow-hidden transition-colors">
      <div class="p-4 border-b border-slate-100 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-800">
        <h3 class="font-semibold text-slate-700 dark:text-gray-400 text-sm uppercase tracking-wider">{{ text.securityTitle }}</h3>
      </div>
      <div class="divide-y divide-slate-100 dark:divide-gray-700">
        <div class="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors cursor-pointer">
          <div class="flex items-center"><div class="p-2 bg-orange-50 dark:bg-gray-700 text-orange-600 dark:text-orange-400 rounded-lg mr-4"><Mail :size="20" /></div><div><p class="font-medium text-slate-800 dark:text-white">{{ text.accountEmail }}</p><p class="text-xs text-slate-500 dark:text-gray-400">{{ email }}</p></div></div>
          <button @click="openModal('email')" class="text-sm text-green-600 dark:text-green-400 font-medium hover:underline px-2 py-1">{{ text.change }}</button>
        </div>
        <div @click="openModal('password')" class="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors cursor-pointer">
          <div class="flex items-center"><div class="p-2 bg-rose-50 dark:bg-gray-700 text-rose-600 dark:text-rose-400 rounded-lg mr-4"><Shield :size="20" /></div><div><p class="font-medium text-slate-800 dark:text-white">{{ text.changePassword }}</p><p class="text-xs text-slate-500 dark:text-gray-400">{{ text.changePasswordDesc }}</p></div></div>
          <ChevronRight :size="18" class="text-slate-400 dark:text-gray-600" />
        </div>
      </div>
    </div>

    <div class="flex justify-center pt-4 pb-8"><span class="text-xs text-slate-400 dark:text-gray-500">{{ text.version }}</span></div>

    <div v-if="activeModal !== 'none'" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in">
      <div class="bg-white dark:bg-gray-800 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden scale-100 border border-slate-100 dark:border-gray-700">
        <div class="px-6 py-4 border-b border-slate-100 dark:border-gray-700 flex justify-between items-center bg-slate-50/50 dark:bg-gray-800"><h3 class="text-lg font-bold text-slate-800 dark:text-white">{{ modalTitle }}</h3><button @click="closeModal" class="text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-700 p-1 rounded-full transition-colors"><X :size="20" /></button></div>
        <div class="p-6 space-y-4">
          <div v-if="feedback" :class="['p-3 rounded-lg text-sm flex items-center', feedback.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400']"><Check v-if="feedback.type === 'success'" :size="16" class="mr-2" /><AlertCircle v-else :size="16" class="mr-2" />{{ feedback.text }}</div>
          <div v-if="activeModal === 'email'"><label class="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">{{ text.emailLabel }}</label><div class="relative"><Mail class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 w-4 h-4" /><input type="email" v-model="tempEmail" placeholder="example@whut.edu.cn" class="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm text-slate-900 dark:text-white" /></div><p class="text-xs text-slate-400 dark:text-gray-500 mt-2">{{ text.emailHint }}</p></div>
          <div v-if="activeModal === 'language'" class="space-y-4"><div><p class="text-sm font-medium text-slate-700 dark:text-gray-300">{{ text.chooseLanguage }}</p><p class="text-xs text-slate-400 dark:text-gray-500 mt-1">{{ text.languageTip }}</p></div><div class="space-y-3"><label v-for="option in languageOptions" :key="option.code" class="flex items-start gap-3 p-4 rounded-xl border transition-all cursor-pointer" :class="selectedLanguage === option.code ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-500/60' : 'border-slate-200 dark:border-gray-700 hover:border-slate-300 dark:hover:border-gray-600'"><input v-model="selectedLanguage" type="radio" name="language" :value="option.code" class="mt-1 text-emerald-600 focus:ring-emerald-500" /><div class="flex-1"><div class="flex items-center justify-between gap-3"><p class="font-medium text-slate-800 dark:text-white">{{ option.nativeLabel }}</p><span v-if="languageStore.locale === option.code" class="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{{ text.current }}</span></div><p class="text-xs text-slate-500 dark:text-gray-400 mt-1">{{ option.englishLabel }}</p></div></label></div><p class="text-xs text-slate-400 dark:text-gray-500">{{ text.unsupported }}</p></div>
          <div v-if="activeModal === 'profile'" class="space-y-4"><div class="flex justify-center mb-4"><div class="relative w-20 h-20"><img :src="user.avatar" class="w-full h-full rounded-full object-cover ring-4 ring-slate-100 dark:ring-gray-700" /><button class="absolute bottom-0 right-0 p-1.5 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg></button></div></div><div><label class="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">{{ text.nickname }}</label><input type="text" v-model="profileForm.name" class="w-full px-4 py-2 bg-slate-50 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" /></div><div><label class="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">{{ text.college }}</label><select v-model="profileForm.college" class="w-full px-4 py-2 bg-slate-50 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"><option value="计算机科学与技术学院">计算机科学与技术学院</option><option value="自动化学院">自动化学院</option><option value="信息工程学院">信息工程学院</option><option value="理学院">理学院</option><option value="艺术与设计学院">艺术与设计学院</option></select></div><div><label class="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">{{ text.grade }}</label><select v-model="profileForm.grade" class="w-full px-4 py-2 bg-slate-50 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"><option value="2020级">2020级</option><option value="2021级">2021级</option><option value="2022级">2022级</option><option value="2023级">2023级</option><option value="2024级">2024级</option><option value="2025级">2025级</option></select></div></div>
          <div v-if="activeModal === 'password'" class="space-y-4"><div><label class="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">{{ text.currentPassword }}</label><div class="relative"><Lock class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 w-4 h-4" /><input type="password" v-model="passwordForm.old" class="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm text-slate-900 dark:text-white" :placeholder="text.passwordPlaceholder" /></div></div><div><label class="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">{{ text.newPassword }}</label><div class="relative"><Lock class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 w-4 h-4" /><input type="password" v-model="passwordForm.new" class="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm text-slate-900 dark:text-white" :placeholder="text.newPasswordPlaceholder" /></div></div><div><label class="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">{{ text.confirmPassword }}</label><div class="relative"><Lock class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 w-4 h-4" /><input type="password" v-model="passwordForm.confirm" class="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm text-slate-900 dark:text-white" :placeholder="text.confirmPasswordPlaceholder" /></div></div></div>
        </div>
        <div class="px-6 py-4 bg-slate-50 dark:bg-gray-800 flex justify-end space-x-3"><button @click="closeModal" :disabled="isLoading" class="px-4 py-2 text-sm font-medium text-slate-600 dark:text-gray-300 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-gray-700 rounded-lg transition-colors">{{ text.cancel }}</button><button @click="handleSave" :disabled="isLoading" class="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors shadow-sm disabled:opacity-70 flex items-center"><Loader2 v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />{{ text.save }}</button></div>
      </div>
    </div>
  </div>
</template>
