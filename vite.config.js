import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
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
