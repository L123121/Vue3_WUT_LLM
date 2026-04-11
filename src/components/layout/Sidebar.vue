<script setup>
import { useAuthStore } from '../../stores/auth.store.js';
import { useLanguageStore } from '../../stores/language.store.js';
import { useRouter } from 'vue-router';
import { LogOut } from 'lucide-vue-next';
import wutLogoImg from '../../assets/wuhan-university-logo.png';
import ConversationList from '../chat/ConversationList.vue';

const wutLogo = wutLogoImg;
const authStore = useAuthStore();
const languageStore = useLanguageStore();
const router = useRouter();

const labels = languageStore.tm('sidebar');

const handleLogout = () => {
  authStore.logout();
  router.push('/login');
};
</script>

<template>
  <div class="w-72 h-screen bg-white/80 dark:bg-gray-900/95 backdrop-blur-md border-r border-slate-200 dark:border-gray-800 flex flex-col z-20 transition-all duration-300 ease-in-out">
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

    <section class="flex-1 min-h-0 px-2 pb-2">
      <ConversationList />
    </section>

    <div class="p-4 mx-4 mb-4 rounded-2xl bg-slate-50 dark:bg-gray-800/50 border border-slate-100 dark:border-gray-800">
      <button
        @click="handleLogout"
        class="flex items-center w-full px-3 py-2.5 text-sm text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-all duration-200 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
      >
        <LogOut :size="16" class="mr-3" />
        <span>{{ labels.logout }}</span>
      </button>
    </div>
  </div>
</template>
