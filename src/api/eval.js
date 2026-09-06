import { apiGet, apiPost, apiPut, API_BASE } from './client.js';

/**
 * 评测服务 API
 */
export const evalApi = {
  /**
   * 获取系统实时指标
   */
  getMetrics: () => apiGet('/eval/metrics').then(res => res.json()),

  /**
   * 导入离线评测报告（服务端持久化，source=manual）
   * @param {Object} report - eval-report.json 内容
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  importManualReport: (report) => apiPost('/eval/import', report).then(res => res.json()),

  /**
   * 已导入的人工评测列表（轻量记录）
   */
  listImportedReports: () => apiGet('/eval/import').then(res => res.json()),

  /**
   * 取导入报告完整 payload（results + 人工打分）
   */
  fetchImportedReport: (id) => apiGet(`/eval/import/${id}`).then(res => res.json()),

  /**
   * 回写人工打分（humanScores / comments 整体替换）
   */
  saveImportedScores: (id, payload) => apiPut(`/eval/import/${id}`, payload).then(res => res.json()),

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
