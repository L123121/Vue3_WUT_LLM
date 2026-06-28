import { createApp } from 'vue';
import { createPinia } from 'pinia';
import VueVirtualScroller from 'vue-virtual-scroller';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
import './style.css';
import router from './router/index.js';
import App from './App.vue';
import { setupGlobalErrorHandler } from './utils/errorHandler.js';
import { useToastStore } from './stores/toast.store.js';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(VueVirtualScroller);

app.mount('#app');

// 全局错误处理（需等 app 挂载后 Pinia 才可用）
const toastStore = useToastStore();
setupGlobalErrorHandler(app, toastStore);
