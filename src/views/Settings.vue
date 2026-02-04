<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAuthStore } from '../stores/auth.store';
import { useThemeStore } from '../stores/theme.store';
import { useNotificationStore } from '../stores/notification.store';
import { Moon, Globe, Shield, ChevronRight, Mail, X, Loader2, Check, AlertCircle, Lock, MessageSquare, Info } from 'lucide-vue-next';

const authStore = useAuthStore();
const themeStore = useThemeStore();
const notificationStore = useNotificationStore();

const user = computed(() => authStore.user!);
const darkMode = computed(() => themeStore.darkMode);

// Account State
const email = ref("student@whut.edu.cn");

// Modal State
const activeModal = ref<'none' | 'email' | 'password' | 'profile'>('none');
const isLoading = ref(false);
const feedback = ref<{type: 'success' | 'error', text: string} | null>(null);

// Form State
const tempEmail = ref('');
const passwordForm = ref({ old: '', new: '', confirm: '' });
const profileForm = ref({ name: '', college: '', grade: '' });

const resetForm = () => {
  tempEmail.value = '';
  passwordForm.value = { old: '', new: '', confirm: '' };
  profileForm.value = { name: '', college: '', grade: '' };
  feedback.value = null;
  isLoading.value = false;
};

const openModal = (type: 'email' | 'password' | 'profile') => {
  resetForm();
  if (type === 'email') tempEmail.value = email.value;
  if (type === 'profile') {
    profileForm.value = {
      name: user.value.name,
      college: user.value.college || '',
      grade: user.value.grade || ''
    };
  }
  activeModal.value = type;
};

const closeModal = () => {
  activeModal.value = 'none';
  resetForm();
};

const handleSaveEmail = () => {
  // Basic validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(tempEmail.value)) {
    feedback.value = { type: 'error', text: '请输入有效的邮箱地址' };
    return;
  }

  isLoading.value = true;
  feedback.value = null;

  // Simulate API call
  setTimeout(() => {
    email.value = tempEmail.value;
    isLoading.value = false;
    feedback.value = { type: 'success', text: '邮箱绑定成功！' };
    setTimeout(closeModal, 1500);
  }, 1000);
};

const handleSavePassword = () => {
  const { old, new: newPass, confirm } = passwordForm.value;
  
  if (!old || !newPass || !confirm) {
    feedback.value = { type: 'error', text: '请填写所有必填项' };
    return;
  }
  
  if (newPass.length < 6) {
    feedback.value = { type: 'error', text: '新密码长度至少需要6位' };
    return;
  }

  if (newPass !== confirm) {
    feedback.value = { type: 'error', text: '两次输入的新密码不一致' };
    return;
  }

  if (old !== '123456') {
     // Mock check against hardcoded password
     feedback.value = { type: 'error', text: '旧密码错误 (提示: 默认密码是 123456)' };
     return;
  }

  isLoading.value = true;
  feedback.value = null;

  // Simulate API call
  setTimeout(() => {
    isLoading.value = false;
    feedback.value = { type: 'success', text: '密码修改成功！' };
    setTimeout(closeModal, 1500);
  }, 1000);
};

const handleSaveProfile = () => {
  if (!profileForm.value.name) {
    feedback.value = { type: 'error', text: '昵称不能为空' };
    return;
  }

  isLoading.value = true;
  feedback.value = null;

  // Simulate API call
  setTimeout(() => {
    authStore.updateUser(profileForm.value);
    isLoading.value = false;
    feedback.value = { type: 'success', text: '资料修改成功！' };
    setTimeout(closeModal, 1500);
  }, 1000);
};
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6 animate-fade-in relative">
    <!-- Profile Section -->
    <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-gray-700 flex items-center transition-colors">
      <div class="w-20 h-20 rounded-full bg-slate-100 dark:bg-gray-700 overflow-hidden ring-4 ring-slate-50 dark:ring-gray-700 shrink-0">
        <img :src="user.avatar" :alt="user.name" class="w-full h-full object-cover" />
      </div>
      <div class="ml-6 flex-1">
        <h2 class="text-xl font-bold text-slate-800 dark:text-white">{{ user.name }}</h2>
        <p class="text-slate-500 dark:text-gray-400 text-sm">{{ user.college || '未设置学院' }} · {{ user.grade || '未设置年级' }}</p>
        <div class="mt-3 flex space-x-3">
           <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
             学号: {{ user.id === 'u1' ? '01220230101' : user.id }}
           </span>
           <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
             状态: 在校
           </span>
        </div>
      </div>
      <button 
        @click="openModal('profile')"
        class="hidden sm:block px-4 py-2 border border-slate-200 dark:border-gray-600 rounded-lg text-sm text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors"
      >
        编辑资料
      </button>
    </div>

    <!-- Settings Groups -->
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-slate-100 dark:border-gray-700 overflow-hidden transition-colors">
      <div class="p-4 border-b border-slate-100 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-800">
        <h3 class="font-semibold text-slate-700 dark:text-gray-400 text-sm uppercase tracking-wider">偏好设置</h3>
      </div>
      
      <div class="divide-y divide-slate-100 dark:divide-gray-700">
        <!-- System Notifications -->
        <div class="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors">
          <div class="flex items-center">
            <div class="p-2 bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400 rounded-lg mr-4">
              <Info :size="20" />
            </div>
            <div>
              <p class="font-medium text-slate-800 dark:text-white">系统通知</p>
              <p class="text-xs text-slate-500 dark:text-gray-400">接收版本更新和维护公告</p>
            </div>
          </div>
          <button 
            @click="notificationStore.togglePreference('system')"
            :class="['w-11 h-6 rounded-full transition-colors relative', notificationStore.preferences.system ? 'bg-green-600' : 'bg-slate-300 dark:bg-gray-600']"
          >
            <span :class="['absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform', notificationStore.preferences.system ? 'translate-x-5' : 'translate-x-0']" />
          </button>
        </div>

        <!-- Message Notifications -->
        <div class="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors">
          <div class="flex items-center">
            <div class="p-2 bg-green-50 dark:bg-gray-700 text-green-600 dark:text-green-400 rounded-lg mr-4">
              <MessageSquare :size="20" />
            </div>
            <div>
              <p class="font-medium text-slate-800 dark:text-white">消息提醒</p>
              <p class="text-xs text-slate-500 dark:text-gray-400">接收互动消息和好友动态</p>
            </div>
          </div>
          <button 
            @click="notificationStore.togglePreference('message')"
            :class="['w-11 h-6 rounded-full transition-colors relative', notificationStore.preferences.message ? 'bg-green-600' : 'bg-slate-300 dark:bg-gray-600']"
          >
            <span :class="['absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform', notificationStore.preferences.message ? 'translate-x-5' : 'translate-x-0']" />
          </button>
        </div>

        <!-- Alert Notifications -->
        <div class="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors">
          <div class="flex items-center">
            <div class="p-2 bg-orange-50 dark:bg-gray-700 text-orange-600 dark:text-orange-400 rounded-lg mr-4">
              <AlertCircle :size="20" />
            </div>
            <div>
              <p class="font-medium text-slate-800 dark:text-white">重要告警</p>
              <p class="text-xs text-slate-500 dark:text-gray-400">接收任务截止和安全提醒</p>
            </div>
          </div>
          <button 
            @click="notificationStore.togglePreference('alert')"
            :class="['w-11 h-6 rounded-full transition-colors relative', notificationStore.preferences.alert ? 'bg-green-600' : 'bg-slate-300 dark:bg-gray-600']"
          >
            <span :class="['absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform', notificationStore.preferences.alert ? 'translate-x-5' : 'translate-x-0']" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors">
          <div class="flex items-center">
            <div class="p-2 bg-purple-50 dark:bg-gray-700 text-purple-600 dark:text-purple-400 rounded-lg mr-4">
              <Moon :size="20" />
            </div>
            <div>
              <p class="font-medium text-slate-800 dark:text-white">深色模式</p>
              <p class="text-xs text-slate-500 dark:text-gray-400">切换日间/夜间主题</p>
            </div>
          </div>
          <button 
            @click="themeStore.toggleDarkMode()"
            :class="['w-11 h-6 rounded-full transition-colors relative', darkMode ? 'bg-green-600' : 'bg-slate-300 dark:bg-gray-600']"
          >
            <span :class="['absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform', darkMode ? 'translate-x-5' : 'translate-x-0']" />
          </button>
        </div>
        
         <div class="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors cursor-pointer">
          <div class="flex items-center">
            <div class="p-2 bg-emerald-50 dark:bg-gray-700 text-emerald-600 dark:text-emerald-400 rounded-lg mr-4">
              <Globe :size="20" />
            </div>
            <div>
              <p class="font-medium text-slate-800 dark:text-white">语言设置</p>
              <p class="text-xs text-slate-500 dark:text-gray-400">当前: 简体中文</p>
            </div>
          </div>
          <ChevronRight :size="18" class="text-slate-400 dark:text-gray-600" />
        </div>
      </div>
    </div>

     <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-slate-100 dark:border-gray-700 overflow-hidden transition-colors">
      <div class="p-4 border-b border-slate-100 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-800">
        <h3 class="font-semibold text-slate-700 dark:text-gray-400 text-sm uppercase tracking-wider">账号安全</h3>
      </div>
      
      <div class="divide-y divide-slate-100 dark:divide-gray-700">
        <div class="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors cursor-pointer">
          <div class="flex items-center">
            <div class="p-2 bg-orange-50 dark:bg-gray-700 text-orange-600 dark:text-orange-400 rounded-lg mr-4">
              <Mail :size="20" />
            </div>
            <div>
              <p class="font-medium text-slate-800 dark:text-white">绑定邮箱</p>
              <p class="text-xs text-slate-500 dark:text-gray-400">{{ email }}</p>
            </div>
          </div>
          <button 
            @click="openModal('email')"
            class="text-sm text-green-600 dark:text-green-400 font-medium hover:underline px-2 py-1"
          >
            修改
          </button>
        </div>

        <div 
          @click="openModal('password')"
          class="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
        >
          <div class="flex items-center">
            <div class="p-2 bg-rose-50 dark:bg-gray-700 text-rose-600 dark:text-rose-400 rounded-lg mr-4">
              <Shield :size="20" />
            </div>
            <div>
              <p class="font-medium text-slate-800 dark:text-white">修改密码</p>
              <p class="text-xs text-slate-500 dark:text-gray-400">建议定期修改密码以保护账号安全</p>
            </div>
          </div>
           <ChevronRight :size="18" class="text-slate-400 dark:text-gray-600" />
        </div>
      </div>
    </div>
    
    <div class="flex justify-center pt-4 pb-8">
      <span class="text-xs text-slate-400 dark:text-gray-500">武理小精灵 v1.0.2 Build 20260127</span>
    </div>

    <!-- Modals Overlay -->
    <div v-if="activeModal !== 'none'" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in">
      <div class="bg-white dark:bg-gray-800 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden scale-100 border border-slate-100 dark:border-gray-700">
        <!-- Modal Header -->
        <div class="px-6 py-4 border-b border-slate-100 dark:border-gray-700 flex justify-between items-center bg-slate-50/50 dark:bg-gray-800">
          <h3 class="text-lg font-bold text-slate-800 dark:text-white">
            {{ activeModal === 'email' ? '修改绑定邮箱' : activeModal === 'profile' ? '编辑个人资料' : '修改登录密码' }}
          </h3>
          <button 
            @click="closeModal"
            class="text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-700 p-1 rounded-full transition-colors"
          >
            <X :size="20" />
          </button>
        </div>

        <!-- Modal Body -->
        <div class="p-6 space-y-4">
          <!-- Feedback Message -->
          <div v-if="feedback" :class="['p-3 rounded-lg text-sm flex items-center', feedback.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400']">
            <Check v-if="feedback.type === 'success'" :size="16" class="mr-2" />
            <AlertCircle v-else :size="16" class="mr-2" />
            {{ feedback.text }}
          </div>

          <div v-if="activeModal === 'email'">
            <label class="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">新的邮箱地址</label>
            <div class="relative">
              <Mail class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 w-4 h-4" />
              <input 
                type="email" 
                v-model="tempEmail"
                placeholder="example@whut.edu.cn"
                class="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm text-slate-900 dark:text-white"
              />
            </div>
            <p class="text-xs text-slate-400 dark:text-gray-500 mt-2">我们将向该邮箱发送验证链接以确认修改。</p>
          </div>

          <div v-if="activeModal === 'profile'" class="space-y-4">
             <!-- Avatar Preview (Simplified) -->
             <div class="flex justify-center mb-4">
                <div class="relative w-20 h-20">
                  <img :src="user.avatar" class="w-full h-full rounded-full object-cover ring-4 ring-slate-100 dark:ring-gray-700" />
                  <button class="absolute bottom-0 right-0 p-1.5 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-colors">
                     <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                  </button>
                </div>
             </div>

             <div>
              <label class="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">昵称</label>
              <input 
                type="text" 
                v-model="profileForm.name"
                class="w-full px-4 py-2 bg-slate-50 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">学院</label>
              <select 
                v-model="profileForm.college"
                class="w-full px-4 py-2 bg-slate-50 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              >
                <option value="计算机科学与技术学院">计算机科学与技术学院</option>
                <option value="自动化学院">自动化学院</option>
                <option value="信息工程学院">信息工程学院</option>
                <option value="理学院">理学院</option>
                <option value="艺术与设计学院">艺术与设计学院</option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">年级</label>
              <select 
                v-model="profileForm.grade"
                class="w-full px-4 py-2 bg-slate-50 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              >
                <option value="2020级">2020级</option>
                <option value="2021级">2021级</option>
                <option value="2022级">2022级</option>
                <option value="2023级">2023级</option>
                <option value="2024级">2024级</option>
                 <option value="2025级">2025级</option>
              </select>
            </div>
          </div>

          <div v-if="activeModal === 'password'" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">当前密码</label>
              <div class="relative">
                 <Lock class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 w-4 h-4" />
                 <input 
                  type="password" 
                  v-model="passwordForm.old"
                  class="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm text-slate-900 dark:text-white"
                  placeholder="请输入旧密码"
                />
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">新密码</label>
              <div class="relative">
                 <Lock class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 w-4 h-4" />
                 <input 
                  type="password" 
                  v-model="passwordForm.new"
                  class="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm text-slate-900 dark:text-white"
                  placeholder="至少 6 位字符"
                />
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">确认新密码</label>
              <div class="relative">
                 <Lock class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 w-4 h-4" />
                 <input 
                  type="password" 
                  v-model="passwordForm.confirm"
                  class="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm text-slate-900 dark:text-white"
                  placeholder="再次输入新密码"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Modal Footer -->
        <div class="px-6 py-4 bg-slate-50 dark:bg-gray-800 flex justify-end space-x-3">
          <button 
            @click="closeModal"
            :disabled="isLoading"
            class="px-4 py-2 text-sm font-medium text-slate-600 dark:text-gray-300 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            取消
          </button>
          <button 
            @click="activeModal === 'email' ? handleSaveEmail() : activeModal === 'profile' ? handleSaveProfile() : handleSavePassword()"
            :disabled="isLoading"
            class="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors shadow-sm disabled:opacity-70 flex items-center"
          >
            <Loader2 v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
            保存修改
          </button>
        </div>
      </div>
    </div>
  </div>
</template>