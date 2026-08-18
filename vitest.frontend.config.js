import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['src/__tests__/**/*.test.js'],
    environment: 'jsdom',
    pool: 'threads',
    maxWorkers: 2,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
