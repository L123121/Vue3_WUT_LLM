<script setup>
import { inject } from 'vue';
import { Menu } from 'lucide-vue-next';

// App.vue provide 的打开移动端侧边栏函数
const openMobileSidebar = inject('openMobileSidebar', null);

const handleClick = () => {
  openMobileSidebar?.();
};
</script>

<template>
  <!-- 移动端汉堡按钮：≥768px（md）时隐藏，桌面端由固定 Sidebar 提供导航 -->
  <button
    type="button"
    aria-label="打开菜单"
    class="md:hidden p-2 rounded-lg text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors duration-200 shrink-0"
    @click="handleClick"
  >
    <Menu :size="20" />
  </button>
</template>
