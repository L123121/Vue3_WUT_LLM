import { describe, expect, it, vi } from 'vitest';
import {
  clearChunkRecoveryMarker,
  isChunkLoadError,
  recoverFromChunkLoadError,
} from '../utils/chunkRecovery.js';

function createBrowser(currentPath = '/knowledge') {
  const values = new Map();
  return {
    location: {
      pathname: currentPath,
      search: '',
      hash: '',
      assign: vi.fn(),
    },
    sessionStorage: {
      getItem: vi.fn((key) => values.get(key) || null),
      setItem: vi.fn((key, value) => values.set(key, value)),
      removeItem: vi.fn((key) => values.delete(key)),
    },
  };
}

describe('chunkRecovery', () => {
  it.each([
    'Failed to fetch dynamically imported module: /assets/RagFeedback-old.js',
    'Importing a module script failed.',
    'Loading chunk feedback failed.',
    'ChunkLoadError: Loading chunk 12 failed',
  ])('识别动态分块加载错误: %s', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it('忽略普通运行时错误', () => {
    expect(isChunkLoadError(new Error('Network request failed'))).toBe(false);
  });

  it('首次失败时记录目标并刷新当前路由', () => {
    const browser = createBrowser();

    const recovered = recoverFromChunkLoadError(
      new Error('Failed to fetch dynamically imported module'),
      { fullPath: '/feedback' },
      browser,
    );

    expect(recovered).toBe(true);
    expect(browser.sessionStorage.setItem).toHaveBeenCalledWith('wut:chunk-recovery', '/feedback');
    expect(browser.location.assign).toHaveBeenCalledWith('/feedback');
  });

  it('同一路由连续失败时不重复刷新', () => {
    const browser = createBrowser();
    recoverFromChunkLoadError(new Error('Importing a module script failed'), { fullPath: '/feedback' }, browser);

    const recovered = recoverFromChunkLoadError(
      new Error('Importing a module script failed'),
      { fullPath: '/feedback' },
      browser,
    );

    expect(recovered).toBe(false);
    expect(browser.location.assign).toHaveBeenCalledTimes(1);
  });

  it('成功导航后清除恢复标记', () => {
    const browser = createBrowser();
    recoverFromChunkLoadError(new Error('Loading chunk feedback failed'), { fullPath: '/feedback' }, browser);

    clearChunkRecoveryMarker(browser);

    expect(browser.sessionStorage.removeItem).toHaveBeenCalledWith('wut:chunk-recovery');
  });
});
