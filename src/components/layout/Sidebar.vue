<script setup lang="ts">
import { useAuthStore } from '../../stores/auth.store';
import { useRouter, useRoute } from 'vue-router';
import { LayoutDashboard, ListTodo, Info, Bot, Settings, LogOut } from 'lucide-vue-next';
import wutLogoImg from '../../assets/wuhan-university-logo.png';

const wutLogo = wutLogoImg;

const authStore = useAuthStore();
const router = useRouter();
const route = useRoute();

const menuItems = [
  { path: '/', label: '首页', icon: LayoutDashboard },
  { path: '/todo', label: '待办列表', icon: ListTodo },
  { path: '/about', label: '关于系统', icon: Info },
  { path: '/chat', label: 'AI 对话', icon: Bot },
];

const handleLogout = () => {
  authStore.logout();
  router.push('/login');
};

const isActive = (path: string) => {
  return route.path === path;
};

const navigateTo = (path: string) => {
  router.push(path);
};
</script>

<template>
  <div class="w-72 h-screen bg-white/80 dark:bg-gray-900/95 backdrop-blur-md border-r border-slate-200 dark:border-gray-800 flex flex-col z-20 transition-all duration-300 ease-in-out">
    <!-- Logo Area -->
    <div class="p-6 pt-8 flex flex-col items-start justify-center">
      <div class="flex items-center gap-3 mb-2 px-2">
        <div class="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center shrink-0">
          <img :src="wutLogo" alt="WUT Logo" class="w-full h-full object-cover scale-125 drop-shadow-md" />
        </div>
        <div>
          <h1 class="text-xl font-extrabold tracking-tight text-slate-800 dark:text-white leading-tight">武理小精灵</h1>
          <p class="text-[10px] font-bold text-blue-800 dark:text-blue-400 tracking-widest uppercase mt-0.5 opacity-90">WUT Assistant</p>
        </div>
      </div>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 px-4 space-y-1.5">
      <p class="px-4 text-xs font-bold text-slate-400 dark:text-slate-600 uppercase tracking-wider mb-4 mt-2">菜单导航</p>
      
      <button
        v-for="item in menuItems"
        :key="item.path"
        @click="navigateTo(item.path)"
        :class="[
          'group w-full flex items-center px-4 py-3.5 rounded-xl transition-all duration-300 ease-out relative overflow-hidden',
          isActive(item.path)
            ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-gray-800 hover:text-slate-900 dark:hover:text-slate-200'
        ]"
      >
        <div v-if="isActive(item.path)" class="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-700 rounded-r-full"></div>
        <component 
          :is="item.icon" 
          :size="20" 
          :class="[
            'mr-3 transition-colors duration-300',
            isActive(item.path) ? 'text-blue-700 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300'
          ]" 
        />
        <span class="font-medium text-sm">{{ item.label }}</span>
      </button>
    </nav>

    <!-- Footer Actions -->
    <div class="p-4 mx-4 mb-4 rounded-2xl bg-slate-50 dark:bg-gray-800/50 border border-slate-100 dark:border-gray-800">
      <button 
        @click="navigateTo('/settings')"
        :class="[
          'flex items-center w-full px-3 py-2.5 text-sm transition-all duration-200 rounded-lg mb-1',
           isActive('/settings') 
           ? 'bg-white dark:bg-gray-700 text-slate-900 dark:text-white font-medium shadow-sm' 
           : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-gray-700/50'
        ]"
      >
        <Settings :size="16" class="mr-3" />
        <span>系统设置</span>
      </button>
      <button 
        @click="handleLogout"
        class="flex items-center w-full px-3 py-2.5 text-sm text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-all duration-200 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
      >
        <LogOut :size="16" class="mr-3" />
        <span>退出登录</span>
      </button>
    </div>
  </div>
</template>