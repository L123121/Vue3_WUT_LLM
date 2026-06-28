import { ref, onUnmounted } from 'vue';
import { evalApi } from '../api/eval.js';

export function useSystemMetrics() {
  const systemMetrics = ref(null);
  const metricsLoading = ref(false);
  const metricsTab = ref(false);
  let metricsTimer = null;

  async function fetchMetrics() {
    metricsLoading.value = true;
    try {
      const result = await evalApi.getMetrics();
      if (result.success) {
        systemMetrics.value = result.data;
      }
    } catch (err) {
      console.warn('[Metrics] 获取失败:', err.message);
    } finally {
      metricsLoading.value = false;
    }
  }

  function startMetricsPolling() {
    fetchMetrics();
    metricsTimer = setInterval(fetchMetrics, 5000);
  }

  function stopMetricsPolling() {
    if (metricsTimer) {
      clearInterval(metricsTimer);
      metricsTimer = null;
    }
  }

  function switchTab(tab) {
    metricsTab.value = tab;
    if (tab) {
      startMetricsPolling();
    } else {
      stopMetricsPolling();
    }
  }

  function formatLatency(ms) {
    if (!ms && ms !== 0) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  function getLatencyColor(ms) {
    if (!ms && ms !== 0) return 'text-gray-400';
    if (ms < 500) return 'text-green-600';
    if (ms < 2000) return 'text-yellow-600';
    return 'text-red-600';
  }

  function getCoverageColor(rate) {
    if (!rate) return 'text-gray-400';
    const n = parseFloat(rate);
    if (n >= 80) return 'text-green-600';
    if (n >= 50) return 'text-yellow-600';
    return 'text-red-600';
  }

  onUnmounted(() => {
    stopMetricsPolling();
  });

  return {
    systemMetrics,
    metricsLoading,
    metricsTab,
    fetchMetrics,
    switchTab,
    formatLatency,
    getLatencyColor,
    getCoverageColor,
  };
}
