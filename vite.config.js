import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { perfOptimizePlugin } from './vite-plugin-perf.js';

// CDN URL: 通过环境变量设置，构建时启用 CDN 部署
// 设置方式: VITE_CDN_URL=https://cdn.your-domain.com npm run build
const cdnUrl = process.env.VITE_CDN_URL || '';

export default defineConfig({
  plugins: [
    vue(),
    // 性能优化插件：preload + 关键 CSS 内联 + CDN 支持
    perfOptimizePlugin({
      cdnUrl,
      // 关键 CSS 内联默认启用，设置 VITE_SKIP_CRITICAL_CSS=1 可跳过
      criticalCss: !process.env.VITE_SKIP_CRITICAL_CSS,
    }),
  ],
  // CDN 部署时设置 base 为 CDN 域名，所有资源引用自动加上前缀
  base: cdnUrl ? `${cdnUrl}/` : '/',
  server: {
    port: 5173,
    host: true,
    watch: {
      ignored: ['**/backend/**', '**/data/**', '**/node_modules/**', '**/.git/**'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        timeout: 120000,
      },
    },
  },
  resolve: {
    alias: {
      vue: 'vue/dist/vue.esm-bundler.js',
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vue-vendor': ['vue', 'vue-router', 'pinia'],
          highlight: ['highlight.js/lib/core'],
          markdown: ['markdown-it'],
          'virtual-scroller': ['vue-virtual-scroller'],
          icons: ['lucide-vue-next'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
