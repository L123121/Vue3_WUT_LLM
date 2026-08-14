import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    // 并行 worker 加载 BGE 模型/向量文件时有资源竞争，单文件仅需 1-2s，
    // 提高超时避免全量并行时误报（单独运行均通过）
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
