import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['backend/__tests__/**/*.test.js'],
    environment: 'node',
    pool: 'forks',
    maxWorkers: 2,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
