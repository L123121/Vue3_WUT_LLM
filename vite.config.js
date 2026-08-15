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
      // 生产构建用 runtime-only 版 Vue（SFC 已预编译，不需要运行时编译器，vue-vendor 可瘦身约 100KB+）
      // 仅 Vitest 需要编译器（单测里用 template 字符串挂载组件）
      ...(process.env.VITEST ? { vue: 'vue/dist/vue.esm-bundler.js' } : {}),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vue-vendor': ['vue', 'vue-router', 'pinia'],
          highlight: ['highlight.js/lib/core'],
          markdown: ['markdown-it'],
          icons: ['lucide-vue-next'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
