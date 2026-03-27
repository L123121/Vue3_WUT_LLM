<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.store.js';
import { useToastStore } from '../stores/toast.store.js';
import { useLanguageStore } from '../stores/language.store.js';
import { User, Lock, ArrowRight, Loader2 } from 'lucide-vue-next';
import wutLogoImg from '../assets/wuhan-university-logo.png';

const wutLogo = wutLogoImg;
const router = useRouter();
const authStore = useAuthStore();
const toast = useToastStore();
const languageStore = useLanguageStore();
const text = languageStore.tm('login');

const username = ref('');
const password = ref('');
const isLoading = ref(false);
const error = ref('');

const handleSubmit = async () => {
  if (!username.value || !password.value) {
    error.value = text.empty;
    return;
  }

  isLoading.value = true;
  error.value = '';

  setTimeout(() => {
    if (password.value === '123456') {
      authStore.login({
        id: 'u1',
        name: username.value || text.fallbackName,
        avatar: 'https://api.dicebear.com/7.x/notionists/svg?seed=Felix',
      });
      toast.success(text.success);
      router.push('/');
    } else {
      error.value = text.wrong;
      toast.error(text.fail);
      isLoading.value = false;
    }
  }, 1000);
};
</script>

<template>
  <div class="min-h-screen relative flex items-center justify-center p-4 overflow-hidden bg-slate-50 dark:bg-gray-950 transition-colors duration-500">
    <div class="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
      <div class="absolute -top-[30%] -left-[10%] w-[70%] h-[70%] rounded-full bg-blue-800/20 blur-[120px] dark:bg-blue-900/20 animate-pulse"></div>
      <div class="absolute top-[40%] -right-[10%] w-[60%] h-[60%] rounded-full bg-cyan-600/20 blur-[100px] dark:bg-cyan-900/20 animate-pulse delay-700"></div>
    </div>

    <div class="w-full max-w-md relative z-10">
      <div class="bg-white/70 dark:bg-gray-900/60 backdrop-blur-xl rounded-3xl shadow-2xl dark:shadow-black/50 border border-white/50 dark:border-gray-700 overflow-hidden transition-all duration-300">
        <div class="pt-12 pb-8 px-10 text-center">
          <div class="flex justify-center mb-8">
            <div class="w-44 h-44 rounded-full overflow-hidden flex items-center justify-center transform hover:scale-105 transition-all duration-500 rotate-3 hover:rotate-0 shadow-[0_0_50px_rgba(37,99,235,0.2)]">
              <img :src="wutLogo" alt="WUT Logo" class="w-full h-full object-cover scale-125 drop-shadow-2xl" />
            </div>
          </div>
          <h2 class="text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight">{{ text.welcome }}</h2>
          <p class="text-slate-500 dark:text-slate-400 mt-2 text-sm font-medium">{{ text.subtitle }}</p>
        </div>

        <div class="px-10 pb-12">
          <form @submit.prevent="handleSubmit" class="space-y-6">
            <div class="space-y-4">
              <div>
                <label class="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 ml-1">{{ text.account }}</label>
                <div class="relative group">
                  <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <User class="h-5 w-5 text-slate-400 dark:text-slate-500 group-focus-within:text-blue-700 transition-colors duration-300" />
                  </div>
                  <input
                    type="text"
                    v-model="username"
                    class="block w-full pl-11 pr-4 py-3.5 bg-slate-50/50 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-700/20 focus:border-blue-700 transition-all duration-200"
                    :placeholder="text.accountPlaceholder"
                  />
                </div>
              </div>

              <div>
                <label class="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 ml-1">{{ text.password }}</label>
                <div class="relative group">
                  <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock class="h-5 w-5 text-slate-400 dark:text-slate-500 group-focus-within:text-blue-700 transition-colors duration-300" />
                  </div>
                  <input
                    type="password"
                    v-model="password"
                    class="block w-full pl-11 pr-4 py-3.5 bg-slate-50/50 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-700/20 focus:border-blue-700 transition-all duration-200"
                    :placeholder="text.passwordPlaceholder"
                  />
                </div>
              </div>
            </div>

            <div v-if="error" class="text-red-500 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/10 p-4 rounded-xl flex items-center animate-in fade-in slide-in-from-top-2">
              <div class="w-1.5 h-1.5 rounded-full bg-red-500 mr-2.5"></div>
              {{ error }}
            </div>

            <button
              type="submit"
              :disabled="isLoading"
              class="w-full flex justify-center items-center py-4 px-4 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-800 to-blue-600 hover:from-blue-900 hover:to-blue-700 dark:from-blue-700 dark:to-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-700/20 transition-all duration-300 shadow-lg shadow-blue-900/30 transform active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed"
            >
              <template v-if="isLoading">
                <Loader2 class="animate-spin -ml-1 mr-2 h-4 w-4" />
                {{ text.loggingIn }}
              </template>
              <template v-else>
                {{ text.submit }} <ArrowRight class="ml-2 h-4 w-4" />
              </template>
            </button>
          </form>
        </div>

        <div class="bg-slate-50/80 dark:bg-gray-800/80 py-4 text-center border-t border-slate-100 dark:border-gray-700">
          <p class="text-xs text-slate-400 dark:text-gray-500">
            &copy; {{ new Date().getFullYear() }} 武汉理工大学 WUT
          </p>
        </div>
      </div>

      <p class="text-center text-slate-400 dark:text-slate-500 text-xs mt-8">
        {{ text.help }}
      </p>
    </div>
  </div>
</template>
