import { createApp } from 'vue';
import { createPinia } from 'pinia';
import './style.css';
import router from './router/index.js';
import App from './App.vue';
import { setupGlobalErrorHandler } from './utils/errorHandler.js';
import { useToastStore } from './stores/toast.store.js';
import { useWebVitals } from './composables/useWebVitals.js';
import { configureAuthErrorHandler } from './api/client.js';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

configureAuthErrorHandler(() => {
  const currentRoute = router.currentRoute.value;
  if (currentRoute.path === '/login') return;
  return router.push({ path: '/login', query: { redirect: currentRoute.fullPath } });
});

app.mount('#app');

// 启动 Web Vitals 采集（LCP/INP/CLS/FCP/TTFB）
useWebVitals();

// 全局错误处理（需等 app 挂载后 Pinia 才可用）
const toastStore = useToastStore();
setupGlobalErrorHandler(app, toastStore);
