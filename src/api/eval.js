import { apiGet, API_BASE } from './client.js';

/**
 * 评测服务 API
 */
export const evalApi = {
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
  runEvaluation: (datasetSize = 5, testCases = null, metadata = {}) => {
    return fetch(`${API_BASE}/eval/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasetSize, testCases, enableRag: true, ...metadata }),
    });
  },
};
