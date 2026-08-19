import { ref } from 'vue';

/**
 * Composable that offloads Markdown rendering to a Web Worker.
 * Falls back to synchronous rendering if Worker is unavailable.
 *
 * Usage:
 *   const { renderInWorker } = useMarkdownWorker();
 *   try {
 *     const html = await renderInWorker('# Hello');
 *   } catch {
 *     // Worker 失败/超时/不可用 — 调用方走主线程兜底
 *   }
 *
 * Worker 为模块级单例：聊天消息气泡会实例化大量 MarkdownRenderer 组件，
 * 若每个组件都创建独立 Worker（含 markdown-it + highlight.js 全套），
 * 长会话会占用几十个常驻 Worker 导致内存爆炸。单例共享一个 Worker 即可。
 *
 * 失败语义：renderInWorker 在「Worker 不可用 / 超时 / onerror」时 reject(Error)。
 * 调用方用 .catch(() => '') 或 try/catch 降级到主线程渲染。
 * 旧的「resolve('') 表示失败」约定已废弃——空串是合法的渲染输出（空内容），
 * 用它兼作失败信号会吞掉真实错误并让 onerror 静默退化。
 */
let worker = null;
let isReady = ref(false);

// pending 条目：{ resolve, reject, timer }
// 每条带独立超时定时器，超时即 reject 并自我清理，杜绝泄漏。
let pendingCallbacks = new Map();
let idCounter = 0;

const WORKER_TIMEOUT_MS = 5000;

function rejectAllPending(reason) {
  for (const [, entry] of pendingCallbacks) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.reject(reason);
  }
  pendingCallbacks.clear();
}

function initWorker() {
  if (worker || isReady.value) return;
  try {
    worker = new Worker(
      new URL('../workers/markdown.worker.js', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e) => {
      const { id, html } = e.data;
      const entry = pendingCallbacks.get(id);
      if (entry) {
        pendingCallbacks.delete(id);
        if (entry.timer) clearTimeout(entry.timer);
        entry.resolve(html);
      }
    };

    worker.onerror = (err) => {
      console.error('[MarkdownWorker] Error:', err);
      // Worker 崩溃：拒绝所有在途请求，调用方各自降级主线程
      rejectAllPending(new Error('markdown worker error'));
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
    return new Promise((resolve, reject) => {
      if (!worker || !isReady.value) {
        reject(new Error('markdown worker unavailable'));
        return;
      }

      const id = ++idCounter;

      // 独立超时：到点未回 → reject 并自我清理，确保 entry 不残留
      const timer = setTimeout(() => {
        if (pendingCallbacks.has(id)) {
          pendingCallbacks.delete(id);
          reject(new Error('markdown worker timeout'));
        }
      }, WORKER_TIMEOUT_MS);

      pendingCallbacks.set(id, { resolve, reject, timer });
      worker.postMessage({ id, content });
    });
  };

  return { isReady, renderInWorker };
}
