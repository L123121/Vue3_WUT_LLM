import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth.store.js';

const routes = [
  {
    path: '/',
    redirect: '/chat'
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue')
  },
  {
    path: '/chat',
    name: 'Chat',
    component: () => import('../views/AIChat.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/knowledge',
    name: 'Knowledge',
    component: () => import('../views/KnowledgeBase.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/eval',
    name: 'Eval',
    component: () => import('../views/EvalScoring.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/Settings.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/chat'
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// 路由守卫
router.beforeEach((to, from, next) => {
  const authStore = useAuthStore();

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next('/login');
  } else if (to.path === '/login' && authStore.isAuthenticated) {
    next('/chat');
  } else {
    next();
  }
});

export default router;
