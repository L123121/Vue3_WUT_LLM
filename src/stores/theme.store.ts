import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export const useThemeStore = defineStore('theme', () => {
  const darkMode = ref(false);

  watch(darkMode, (isDark) => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, { immediate: true });

  const toggleDarkMode = () => {
    darkMode.value = !darkMode.value;
  };

  return { darkMode, toggleDarkMode };
});