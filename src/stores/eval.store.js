import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { evalApi } from '../api/eval.js';

export const useEvalStore = defineStore('eval', () => {
  const evalResults = ref([]);
  const isRunning = ref(false);
  const lastRunAt = ref(null);
  const overallScore = ref(null);

  const resultCount = computed(() => evalResults.value.length);
  const avgScore = computed(() => {
    if (evalResults.value.length === 0) return null;
    const sum = evalResults.value.reduce((s, r) => s + (r.overall || 0), 0);
    return (sum / evalResults.value.length).toFixed(3);
  });

  /**
   * 启动后端 RAGAS 自动化评测
   * @param {number} datasetSize - 数据集大小
   * @param {function} onLog - 日志回调 (text) => void
   * @returns {Promise<Object>} 评测结果
   */
  const runBackendEval = async (datasetSize = 45, onLog) => {
    isRunning.value = true;
    try {
      const response = await evalApi.runEvaluation(datasetSize);

      if (!response.ok) {
        throw new Error(`评测请求失败 (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let finalResult = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const data = trimmed.slice(5).trim();
          try {
            const json = JSON.parse(data);
            if (json.type === 'log' && onLog) {
              onLog(json.text);
            } else if (json.type === 'done') {
              finalResult = json;
            }
          } catch {
            // skip parse errors
          }
        }
      }

      if (finalResult) {
        overallScore.value = finalResult.overallScore;
        lastRunAt.value = new Date().toISOString();
        evalResults.value = finalResult.metrics || [];
      }

      return finalResult;
    } catch (error) {
      console.error('[Eval] Backend evaluation failed:', error);
      throw error;
    } finally {
      isRunning.value = false;
    }
  };

  /**
   * 批量计算评测指标
   */
  const calculateMetrics = async (results) => {
    try {
      const data = await evalApi.calculateMetrics(results);
      if (data.success) {
        evalResults.value = data.data.metrics;
        overallScore.value = data.data.avgOverall;
        lastRunAt.value = new Date().toISOString();
      }
      return data;
    } catch (error) {
      console.error('[Eval] Calculate metrics failed:', error);
      throw error;
    }
  };

  const clearResults = () => {
    evalResults.value = [];
    overallScore.value = null;
    lastRunAt.value = null;
  };

  return {
    evalResults,
    isRunning,
    lastRunAt,
    overallScore,
    resultCount,
    avgScore,
    runBackendEval,
    calculateMetrics,
    clearResults,
  };
});
