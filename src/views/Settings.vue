<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAuthStore } from '../stores/auth.store.ts';
import { useThemeStore } from '../stores/theme.store.ts';
import { Bell, Moon, Globe, Shield, ChevronRight, Mail, X, Loader2, Check, AlertCircle, Lock } from 'lucide-vue-next';

const authStore = useAuthStore();
const themeStore = useThemeStore();

const user = computed(() => authStore.user!);
const darkMode = computed(() => themeStore.darkMode);

// General Settings
const notifications = ref(true);

// Account State
const email = ref("student@whut.edu.cn");

// Modal State
const activeModal = ref<'none' | 'email' | 'password'>('none');
const isLoading = ref(false);
const feedback = ref<{type: 'success' | 'error', text: string} | null>(null);

// Form State
const tempEmail = ref('');
const passwordForm = ref({ old: '', new: '', confirm: '' });

const resetForm = () => {
  tempEmail.value = '';
  passwordForm.value = { old: '', new: '', confirm: '' };
  feedback.value = null;
  isLoading.value = false;
};

const openModal = (type: 'email' | 'password') => {
  resetForm();
  if (type === 'email') tempEmail.value = email.value;
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
        <p class="text-slate-500 dark:text-gray-400 text-sm">计算机科学与技术学院 · 2021级</p>
        <div class="mt-3 flex space-x-3">
           <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
             学号: {{ user.id === 'u1' ? '01220230101' : user.id }}
           </span>
           <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
             状态: 在校
           </span>
        </div>
      </div>
      <button class="hidden sm:block px-4 py-2 border border-slate-200 dark:border-gray-600 rounded-lg text-sm text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors">
        编辑资料
      </button>
    </div>

    <!-- Settings Groups -->
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-slate-100 dark:border-gray-700 overflow-hidden transition-colors">
      <div class="p-4 border-b border-slate-100 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-800">
        <h3 class="font-semibold text-slate-700 dark:text-gray-400 text-sm uppercase tracking-wider">偏好设置</h3>
      </div>
      
      <div class="divide-y divide-slate-100 dark:divide-gray-700">
        <div class="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors">
          <div class="flex items-center">
            <div class="p-2 bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400 rounded-lg mr-4">
              <Bell :size="20" />
            </div>
            <div>
              <p class="font-medium text-slate-800 dark:text-white">消息通知</p>
              <p class="text-xs text-slate-500 dark:text-gray-400">接收课程提醒和系统公告</p>
            </div>
          </div>
          <!-- Toggle Button Component -->
          <button 
            @click="notifications = !notifications"
            :class="['w-11 h-6 rounded-full transition-colors relative', notifications ? 'bg-green-600' : 'bg-slate-300 dark:bg-gray-600']"
          >
            <span :class="['absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform', notifications ? 'translate-x-5' : 'translate-x-0']" />
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
      <span class="text-xs text-slate-400 dark:text-gray-500">武理小精灵 v1.0.2 Build 20231027</span>
    </div>

    <!-- Modals Overlay -->
    <div v-if="activeModal !== 'none'" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in">
      <div class="bg-white dark:bg-gray-800 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden scale-100 border border-slate-100 dark:border-gray-700">
        <!-- Modal Header -->
        <div class="px-6 py-4 border-b border-slate-100 dark:border-gray-700 flex justify-between items-center bg-slate-50/50 dark:bg-gray-800">
          <h3 class="text-lg font-bold text-slate-800 dark:text-white">
            {{ activeModal === 'email' ? '修改绑定邮箱' : '修改登录密码' }}
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

          <div v-else class="space-y-4">
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
            @click="activeModal === 'email' ? handleSaveEmail() : handleSavePassword()"
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