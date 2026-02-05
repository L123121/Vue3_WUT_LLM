import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth.store.ts';
import { defineAsyncComponent, h } from 'vue';

// 懒加载组件工厂函数
const lazyLoad = (loader: () => Promise<any>) => {
  return defineAsyncComponent({
    loader,
    loadingComponent: {
      render() {
        return h('div', { class: 'flex items-center justify-center h-64' }, [
          h('div', { class: 'animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500' })
        ]);
      }
    },
    errorComponent: {
      render() {
        return h('div', { class: 'flex items-center justify-center h-64 text-red-500' }, '加载失败，请刷新页面');
      }
    },
    delay: 200,
    timeout: 10000
  });
};

// 同步加载 - 首屏关键页面
import Home from '../views/Home.vue';
import Login from '../views/Login.vue';

// 异步加载 - 非首屏页面（按需导入，Vite 自动分包）
const TodoList = lazyLoad(() => import('../views/TodoList.vue'));
const AIChat = lazyLoad(() => import('../views/AIChat.vue'));
const Settings = lazyLoad(() => import('../views/Settings.vue'));
const About = lazyLoad(() => import('../views/About.vue'));

const routes = [
  { path: '/login', name: 'Login', component: Login },
  { path: '/', name: 'Home', component: Home, meta: { requiresAuth: true } },
  { path: '/todo', name: 'Todo', component: TodoList, meta: { requiresAuth: true } },
  { path: '/chat', name: 'Chat', component: AIChat, meta: { requiresAuth: true } },
  { path: '/settings', name: 'Settings', component: Settings, meta: { requiresAuth: true } },
  { path: '/about', name: 'About', component: About, meta: { requiresAuth: true } },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to,_, next) => {
  const authStore = useAuthStore();
  if (to.meta.requiresAuth && !authStore.user) {
    next('/login');
  } else if (to.path === '/login' && authStore.user) {
    next('/');
  } else {
    next();
  }
});

export default router;