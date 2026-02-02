import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth.store.ts';

import Home from '../views/Home.vue';
import Login from '../views/Login.vue';
import TodoList from '../views/TodoList.vue';
import AIChat from '../views/AIChat.vue';
import Settings from '../views/Settings.vue';
import About from '../views/About.vue';

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

router.beforeEach((to, from, next) => {
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