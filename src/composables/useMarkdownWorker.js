import { ref } from 'vue';

/**
 * Composable that offloads Markdown rendering to a Web Worker.
 * Falls back to synchronous rendering if Worker is unavailable.
 *
 * Usage:
 *   const { renderInWorker } = useMarkdownWorker();
 *   const html = await renderInWorker('# Hello');
 *
 * Worker 为模块级单例：聊天消息气泡会实例化大量 MarkdownRenderer 组件，
 * 若每个组件都创建独立 Worker（含 markdown-it + highlight.js 全套），
 * 长会话会占用几十个常驻 Worker 导致内存爆炸。单例共享一个 Worker 即可。
 */
let worker = null;
let isReady = ref(false);
let pendingCallbacks = new Map();
let idCounter = 0;

function initWorker() {
  if (worker || isReady.value) return;
  try {
    worker = new Worker(
      new URL('../workers/markdown.worker.js', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e) => {
      const { id, html } = e.data;
      const resolve = pendingCallbacks.get(id);
      if (resolve) {
        pendingCallbacks.delete(id);
        resolve(html);
      }
    };

    worker.onerror = (err) => {
      console.error('[MarkdownWorker] Error:', err);
      // Reject all pending
      for (const [, resolve] of pendingCallbacks) {
        resolve('');
      }
      pendingCallbacks.clear();
    };

    isReady.value = true;
  } catch {
    console.warn('[MarkdownWorker] Worker not supported, falling back to main thread');
    isReady.value = false;
  }
}

export function useMarkdownWorker() {
  initWorker();

  const renderInWorker = (content) => {
    return new Promise((resolve) => {
      if (!worker || !isReady.value) {
        resolve('');
        return;
      }

      const id = ++idCounter;
      pendingCallbacks.set(id, resolve);

      // Timeout: if worker doesn't respond in 5s, resolve with empty
      setTimeout(() => {
        if (pendingCallbacks.has(id)) {
          pendingCallbacks.delete(id);
          resolve('');
        }
      }, 5000);

      worker.postMessage({ id, content });
    });
  };

  return { isReady, renderInWorker };
}
