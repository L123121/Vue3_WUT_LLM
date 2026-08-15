/**
 * useWebVitals — 核心 Web Vitals 采集与上报
 *
 * 采集指标:
 *   LCP  — Largest Contentful Paint（最大内容渲染）
 *   INP  — Interaction to Next Paint（交互延迟，替代 FID）
 *   CLS  — Cumulative Layout Shift（累积布局偏移）
 *   FCP  — First Contentful Paint（首次内容渲染）
 *   TTFB — Time to First Byte（首字节时间）
 *
 * 上报策略: navigator.sendBeacon → fetch keepalive（降级）
 *
 * 使用方式 (main.js):
 *   import { useWebVitals } from './composables/useWebVitals.js';
 *   useWebVitals();
 */
import { onMounted } from 'vue';

/**
 * 上报单条指标到后端
 */
function reportMetric(metric) {
  const payload = {
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    delta: metric.delta,
    id: metric.id,
    navigationType: metric.navigationType,
    url: window.location.pathname,
    timestamp: Date.now(),
  };

  // sendBeacon 优先（页面卸载时也能发出）
  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/metrics/web-vitals', body);
  } else {
    fetch('/api/metrics/web-vitals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  }

  // 开发环境输出到控制台
  if (import.meta.env.DEV) {
    const ratingEmoji = { good: '🟢', 'needs-improvement': '🟡', poor: '🔴' };
    console.debug(
      `${ratingEmoji[metric.rating] || '⚪'} [Web Vitals] ${metric.name}: ` +
      `${metric.rating === 'good' ? metric.value.toFixed(0) : metric.value.toFixed(2)} ` +
      `(${metric.rating})`
    );
  }
}

/**
 * 启动 Web Vitals 采集
 * 在 app mount 后调用一次即可
 */
export function useWebVitals() {
  onMounted(async () => {
    try {
      const { onLCP, onINP, onCLS, onFCP, onTTFB } = await import('web-vitals');

      // 注册所有核心指标回调
      onLCP(reportMetric);
      onINP(reportMetric);
      onCLS(reportMetric);
      onFCP(reportMetric);
      onTTFB(reportMetric);

      if (import.meta.env.DEV) {
        console.debug('📊 [Web Vitals] 采集已启动 (LCP/INP/CLS/FCP/TTFB)');
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[Web Vitals] 加载失败:', err.message);
      }
    }
  });
}
