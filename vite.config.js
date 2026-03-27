import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
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
