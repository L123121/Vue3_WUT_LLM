import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000', // 后端地址
        changeOrigin: true,
        secure: false
      }
    }
  },
  resolve: {
    alias: {
      'vue': 'vue/dist/vue.esm-bundler.js' // 确保使用支持运行时编译的 Vue 版本
    }
  },
  build: {
    // 分包优化
    rollupOptions: {
      output: {
        manualChunks: {
          // 核心 Vue 库
          'vue-vendor': ['vue', 'vue-router', 'pinia'],
          // 代码高亮库
          'highlight': ['highlight.js'],
          // Markdown 解析
          'markdown': ['markdown-it'],
          // 虚拟滚动
          'virtual-scroller': ['vue-virtual-scroller'],
          // 图标库
          'icons': ['lucide-vue-next']
        }
      }
    },
    chunkSizeWarningLimit: 600
  }
})