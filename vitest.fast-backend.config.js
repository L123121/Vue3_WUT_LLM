import { defineConfig } from 'vitest/config';

const integrationTests = [
  'backend/__tests__/document.service.test.js',
  'backend/__tests__/embedding.service.test.js',
  'backend/__tests__/table-detect.test.js',
  'backend/__tests__/vector-store.service.test.js',
  'backend/__tests__/vector-store-qdrant.test.js',
  'backend/__tests__/agent-tools.test.js',
  'backend/__tests__/chat.controller.test.js',
];

export default defineConfig({
  test: {
    include: ['backend/__tests__/**/*.test.js'],
    exclude: integrationTests,
    environment: 'node',
    pool: 'forks',
    maxWorkers: 2,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
