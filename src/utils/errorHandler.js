/**
 * 全局错误处理与上报
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

/**
 * 统一错误上报：带上下文信息，控制台可追溯
 * 替代分散的 console.warn / console.error，统一格式
 *
 * @param {string} action - 出错的操作名称（如 "loadDocuments"、"clearMessages"）
 * @param {Error|string} err - 错误对象或消息
 * @param {object} [context] - 额外的上下文信息（如 { userId, docId }）
 */
export function reportError(action, err, context) {
  const msg = err?.message || err?.toString?.() || err || '未知错误';
  const detail = context ? ` | context: ${JSON.stringify(context)}` : '';
  console.error(`[${action}] ${msg}${detail}`);
}

export function setupGlobalErrorHandler(app, toastStore) {
  app.config.errorHandler = (err, instance, info) => {
    reportError('VueError', err, { info });
    if (toastStore) toastStore.error(friendly(err));
  };

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason?.name === 'AbortError' || reason?.message?.includes('navigation')) return;
    reportError('UnhandledRejection', reason);
    if (toastStore) toastStore.error(friendly(reason));
    event.preventDefault();
  });

  window.addEventListener('error', (event) => {
    if (event.target?.tagName) return;
    reportError('GlobalError', event.error || event.message);
    if (toastStore) toastStore.error(friendly(event.error || event.message));
  });
}
