import { apiGet, apiPost } from './client.js';

/**
 * 评测服务 API
 */
export const evalApi = {
  /**
   * 评测服务健康检查
   */
  health: () => apiGet('/eval/health').then(res => res.json()),

  /**
   * 获取系统实时指标
   */
  getMetrics: () => apiGet('/eval/metrics').then(res => res.json()),

  /**
   * 触发 RAGAS 真实评测（SSE 流式）
   * @param {number} datasetSize - 评测数据集大小
   * @param {Array} testCases - 可选，自定义测试集
   * @returns {ReadableStream} SSE 流
   */
  runEvaluation: (datasetSize = 5, testCases = null) => {
    return fetch('/api/eval/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasetSize, testCases, enableRag: true }),
    });
  },

  /**
   * 批量计算评测指标（非流式）
   */
  calculateMetrics: (results) => apiPost('/eval/metrics', { results }).then(res => res.json()),
};
