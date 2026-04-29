import { createApp } from 'vue';
import { createPinia } from 'pinia';
import VueVirtualScroller from 'vue-virtual-scroller';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
import './style.css';
import router from './router/index.js';
import App from './App.vue';
import { usePerformanceMonitor } from './utils/performance.js';

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(VueVirtualScroller);
app.mount('#app');

// 启动性能监控
const performanceMonitor = usePerformanceMonitor();
performanceMonitor.startMonitoring();
