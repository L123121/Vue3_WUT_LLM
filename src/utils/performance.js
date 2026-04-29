// 性能监控工具
// 收集 Web Vitals 指标：LCP、FID、CLS、FCP、TTFB

const STORAGE_KEY = 'performance_metrics';
const MAX_RECORDS = 100;

// 指标阈值（基于 Google Core Web Vitals 标准）
const THRESHOLDS = {
  LCP: { good: 2500, needsImprovement: 4000 }, // 最大内容绘制 (ms)
  FID: { good: 100, needsImprovement: 300 }, // 首次输入延迟 (ms)
  CLS: { good: 0.1, needsImprovement: 0.25 }, // 累积布局偏移 (无单位)
  FCP: { good: 1800, needsImprovement: 3000 }, // 首次内容绘制 (ms)
  TTFB: { good: 800, needsImprovement: 1800 }, // 首字节时间 (ms)
};

// 评级函数
const getRating = (name, value) => {
  const threshold = THRESHOLDS[name];
  if (!threshold) return 'unknown';
  if (value <= threshold.good) return 'good';
  if (value <= threshold.needsImprovement) return 'needs-improvement';
  return 'poor';
};

// 加载历史数据
const loadMetrics = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// 保存数据
const saveMetrics = (metrics) => {
  try {
    const trimmed = metrics.slice(-MAX_RECORDS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.error('Failed to save performance metrics:', error);
  }
};

// 创建指标记录
const createMetricRecord = (name, value, rating) => ({
  id: `metric-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  name,
  value: Math.round(value * 100) / 100,
  rating,
  timestamp: new Date().toISOString(),
  url: window.location.pathname,
});

// 观察 LCP
const observeLCP = (callback) => {
  if (!('PerformanceObserver' in window)) return;

  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1];
      const value = lastEntry.startTime;
      const rating = getRating('LCP', value);
      callback(createMetricRecord('LCP', value, rating));
    });
    observer.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (error) {
    console.warn('LCP observation not supported:', error);
  }
};

// 观察 FID
const observeFID = (callback) => {
  if (!('PerformanceObserver' in window)) return;

  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry) => {
        const value = entry.processingStart - entry.startTime;
        const rating = getRating('FID', value);
        callback(createMetricRecord('FID', value, rating));
      });
    });
    observer.observe({ type: 'first-input', buffered: true });
  } catch (error) {
    console.warn('FID observation not supported:', error);
  }
};

// 观察 CLS
const observeCLS = (callback) => {
  if (!('PerformanceObserver' in window)) return;

  let clsValue = 0;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          clsValue += entry.value;
        }
      }
    });
    observer.observe({ type: 'layout-shift', buffered: true });

    // 页面隐藏时报告最终 CLS 值
    const reportCLS = () => {
      if (clsValue > 0) {
        const rating = getRating('CLS', clsValue);
        callback(createMetricRecord('CLS', clsValue, rating));
      }
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        reportCLS();
      }
    });

    window.addEventListener('pagehide', reportCLS);
  } catch (error) {
    console.warn('CLS observation not supported:', error);
  }
};

// 获取 FCP
const getFCP = (callback) => {
  if (!('PerformanceObserver' in window)) return;

  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry) => {
        if (entry.name === 'first-contentful-paint') {
          const value = entry.startTime;
          const rating = getRating('FCP', value);
          callback(createMetricRecord('FCP', value, rating));
        }
      });
    });
    observer.observe({ type: 'paint', buffered: true });
  } catch (error) {
    console.warn('FCP observation not supported:', error);
  }
};

// 获取 TTFB
const getTTFB = (callback) => {
  const navigationEntry = performance.getEntriesByType('navigation')[0];
  if (navigationEntry) {
    const value = navigationEntry.responseStart - navigationEntry.requestStart;
    const rating = getRating('TTFB', value);
    callback(createMetricRecord('TTFB', value, rating));
  }
};

// 导出性能监控 API
export const usePerformanceMonitor = () => {
  const metrics = loadMetrics();

  // 记录上次记录的指标，用于去重
  const lastRecorded = {};

  const recordMetric = (metric) => {
    // 去重：相同指标在 5 秒内不重复记录
    const key = metric.name;
    const now = Date.now();
    if (lastRecorded[key] && now - lastRecorded[key] < 5000) {
      return;
    }
    lastRecorded[key] = now;

    metrics.push(metric);
    saveMetrics(metrics);
  };

  // 启动所有观察器
  const startMonitoring = () => {
    observeLCP(recordMetric);
    observeFID(recordMetric);
    observeCLS(recordMetric);
    getFCP(recordMetric);
    getTTFB(recordMetric);
  };

  // 获取统计数据
  const getStats = () => {
    const stats = { LCP: [], FID: [], CLS: [], FCP: [], TTFB: [] };

    metrics.forEach((m) => {
      if (stats[m.name]) {
        stats[m.name].push(m.value);
      }
    });

    const result = {};
    Object.keys(stats).forEach((name) => {
      const values = stats[name];
      if (values.length > 0) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const latest = values[values.length - 1];
        const rating = getRating(name, avg);

        result[name] = {
          avg: Math.round(avg * 100) / 100,
          min: Math.round(min * 100) / 100,
          max: Math.round(max * 100) / 100,
          latest: Math.round(latest * 100) / 100,
          rating,
          count: values.length,
          threshold: THRESHOLDS[name],
        };
      }
    });

    return result;
  };

  // 获取最近记录（去重）
  const getRecentMetrics = (limit = 20) => {
    // 按时间戳分组，相同时间戳（秒级）的只保留一条
    const seen = new Set();
    const deduped = [];

    // 从后往前遍历，保留最新的
    for (let i = metrics.length - 1; i >= 0 && deduped.length < limit; i--) {
      const m = metrics[i];
      // 使用指标名称和时间戳（秒级）作为去重key
      const key = `${m.name}-${Math.floor(new Date(m.timestamp).getTime() / 1000)}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.unshift(m);
      }
    }

    return deduped;
  };

  // 清除数据
  const clearMetrics = () => {
    metrics.length = 0;
    localStorage.removeItem(STORAGE_KEY);
  };

  return {
    metrics,
    startMonitoring,
    getStats,
    getRecentMetrics,
    clearMetrics,
    thresholds: THRESHOLDS,
  };
};

// 性能数据生成器（用于演示）
export const generateDemoMetrics = () => {
  const demoData = [];

  // 生成过去 7 天的模拟数据
  for (let day = 6; day >= 0; day--) {
    const baseTime = Date.now() - day * 24 * 60 * 60 * 1000;

    // 每天生成 5-10 条记录
    const count = 5 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
      const timestamp = new Date(baseTime + i * 3600000).toISOString();

      // LCP: 1500-4500ms
      demoData.push({
        id: `demo-lcp-${day}-${i}`,
        name: 'LCP',
        value: 1500 + Math.random() * 3000,
        rating: 'good',
        timestamp,
        url: '/chat',
      });

      // FID: 50-200ms
      demoData.push({
        id: `demo-fid-${day}-${i}`,
        name: 'FID',
        value: 50 + Math.random() * 150,
        rating: 'good',
        timestamp,
        url: '/chat',
      });

      // CLS: 0.01-0.3
      demoData.push({
        id: `demo-cls-${day}-${i}`,
        name: 'CLS',
        value: 0.01 + Math.random() * 0.29,
        rating: 'good',
        timestamp,
        url: '/chat',
      });

      // FCP: 800-2500ms
      demoData.push({
        id: `demo-fcp-${day}-${i}`,
        name: 'FCP',
        value: 800 + Math.random() * 1700,
        rating: 'good',
        timestamp,
        url: '/chat',
      });

      // TTFB: 200-1500ms
      demoData.push({
        id: `demo-ttfb-${day}-${i}`,
        name: 'TTFB',
        value: 200 + Math.random() * 1300,
        rating: 'good',
        timestamp,
        url: '/chat',
      });
    }
  }

  // 重新计算评级
  demoData.forEach((item) => {
    item.rating = getRating(item.name, item.value);
  });

  return demoData;
};

// 初始化演示数据
export const initDemoData = () => {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return false;

  const demoMetrics = generateDemoMetrics();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(demoMetrics));
  return true;
};
