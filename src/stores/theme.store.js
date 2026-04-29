import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export const useThemeStore = defineStore('theme', () => {
  const stored = localStorage.getItem('darkMode');
  const darkMode = ref(stored === 'true');

  watch(darkMode, (isDark) => {
    if (isDark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    localStorage.setItem('darkMode', String(isDark));
  }, { immediate: true });

  const toggleDarkMode = () => {
    darkMode.value = !darkMode.value;
  };

  return { darkMode, toggleDarkMode };
});
