import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitestEntry = path.join(rootDir, 'node_modules', 'vitest', 'vitest.mjs');
const mode = process.argv[2] || 'fast';
const suites = {
  fast: ['vitest.frontend.config.js', 'vitest.fast-backend.config.js'],
  all: ['vitest.frontend.config.js', 'vitest.backend.config.js'],
  frontend: ['vitest.frontend.config.js'],
  backend: ['vitest.backend.config.js'],
  integration: ['vitest.integration.config.js'],
};

if (!suites[mode]) {
  console.error(`未知测试模式：${mode}`);
  process.exit(1);
}

const startedAt = Date.now();
const runSuite = (configFile) => new Promise((resolve) => {
  const child = spawn(process.execPath, [vitestEntry, 'run', '--config', configFile], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => resolve({ configFile, code: code ?? 1, signal }));
});

const results = await Promise.all(suites[mode].map(runSuite));
const failed = results.filter((result) => result.code !== 0);
const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

console.log(`\n[Test Suites] mode=${mode} elapsed=${elapsedSeconds}s`);
if (failed.length > 0) {
  failed.forEach((result) => console.error(`[Test Suites] ${result.configFile} failed code=${result.code} signal=${result.signal || '-'}`));
  process.exit(1);
}
