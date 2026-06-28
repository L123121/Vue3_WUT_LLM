/**
 * Global error handling setup for Vue app.
 * Catches unhandled errors and promise rejections.
 */

const friendly = (err) => {
  const msg = (err?.message || err?.toString?.() || '').toLowerCase();
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused') || msg.includes('网络'))
    return '网络连接失败，请确认后端服务已启动';
  if (msg.includes('timeout') || msg.includes('超时'))
    return '请求超时，请稍后重试';
  if (msg.includes('auth') || msg.includes('401') || msg.includes('unauthorized') || msg.includes('登录'))
    return '登录已过期，请刷新页面重新登录';
  return '操作失败，请稍后重试';
};

export function setupGlobalErrorHandler(app, toastStore) {
  app.config.errorHandler = (err, instance, info) => {
    console.error('[Vue Error]', err, info);
    if (toastStore) toastStore.error(friendly(err));
  };

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason?.name === 'AbortError' || reason?.message?.includes('navigation')) return;
    console.error('[Unhandled Rejection]', reason);
    if (toastStore) toastStore.error(friendly(reason));
    event.preventDefault();
  });

  window.addEventListener('error', (event) => {
    if (event.target?.tagName) return;
    console.error('[Global Error]', event.error || event.message);
    if (toastStore) toastStore.error(friendly(event.error || event.message));
  });
}
