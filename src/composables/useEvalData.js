import { ref, computed } from 'vue';
import { evalApi } from '../api/eval.js';

export function useEvalData() {
  const evalData = ref(null);
  const currentIndex = ref(0);
  const humanScores = ref({});
  const comments = ref({});
  const loading = ref(false);

  // 服务端持久化（导入的评测报告）：currentReportId 为空 = 本地降级模式
  const currentReportId = ref(null);
  const importedReports = ref([]);
  const saving = ref(false);
  const serverError = ref('');

  const currentItem = computed(() => {
    if (!evalData.value?.results) return null;
    return evalData.value.results[currentIndex.value] || null;
  });

  const stats = computed(() => {
    if (!evalData.value?.results) return null;
    const results = evalData.value.results;
    const scored = Object.keys(humanScores.value).length;
    const validResults = results.filter(r => r.metrics);
    return {
      total: results.length,
      scored,
      remaining: results.length - scored,
      avgHuman: scored > 0
        ? (Object.values(humanScores.value).reduce((s, v) => s + v, 0) / scored).toFixed(2)
        : 'N/A',
      avgRagas: validResults.length > 0
        ? (validResults.reduce((s, r) => s + (r.metrics?.overall || 0), 0) / validResults.length * 100).toFixed(1) + '%'
        : 'N/A'
    };
  });

  function applyPayload(payload) {
    evalData.value = { results: payload.results || [] };
    humanScores.value = payload.humanScores || {};
    comments.value = payload.comments || {};
    currentIndex.value = 0;
  }

  /** 已导入评测列表（侧栏选择用） */
  async function loadImportedReports() {
    try {
      const res = await evalApi.listImportedReports();
      if (res.success) importedReports.value = res.data || [];
    } catch {
      // 后端不可达时保持空列表，页面仍可用本地模式
    }
  }

  /** 选中一条已导入评测：从服务端拉完整 payload 回放工作台 */
  async function selectImportedReport(id) {
    loading.value = true;
    serverError.value = '';
    try {
      const res = await evalApi.fetchImportedReport(id);
      if (!res.success) throw new Error(res.error || '加载失败');
      currentReportId.value = id;
      applyPayload(res.data);
    } catch (err) {
      serverError.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 上传评测报告：优先走服务端导入（持久化 + 可续打分）；
   * 后端不可达/导入失败时降级为原本地模式（只读浏览，刷新即丢）。
   */
  async function importFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    loading.value = true;
    serverError.value = '';
    try {
      const report = JSON.parse(await file.text());
      try {
        const res = await evalApi.importManualReport(report);
        if (!res.success) throw new Error(res.error || '导入失败');
        currentReportId.value = res.data.id;
        await loadImportedReports();
        const payloadRes = await evalApi.fetchImportedReport(res.data.id);
        if (!payloadRes.success) throw new Error(payloadRes.error || '回读失败');
        applyPayload(payloadRes.data);
        return;
      } catch (serverErr) {
        // 落到本地降级
        serverError.value = `服务端导入失败，已降级为本地模式（打分不会持久化）：${serverErr.message}`;
      }
      evalData.value = report;
      humanScores.value = report.humanScores || {};
      comments.value = report.comments || {};
      currentIndex.value = 0;
      currentReportId.value = null;
    } catch (err) {
      serverError.value = `JSON 解析失败: ${err.message}`;
    } finally {
      loading.value = false;
      event.target.value = '';
    }
  }

  /** 人工打分回写服务端（仅导入模式可用） */
  async function saveScores() {
    if (!currentReportId.value) return false;
    saving.value = true;
    try {
      const res = await evalApi.saveImportedScores(currentReportId.value, {
        humanScores: humanScores.value,
        comments: comments.value,
      });
      if (!res.success) throw new Error(res.error || '保存失败');
      serverError.value = '';
      await loadImportedReports();
      return true;
    } catch (err) {
      serverError.value = err.message;
      return false;
    } finally {
      saving.value = false;
    }
  }

  function setScore(id, score) {
    humanScores.value[id] = score;
  }

  function exportScores() {
    const output = {
      timestamp: new Date().toISOString(),
      summary: stats.value,
      humanScores: humanScores.value,
      comments: comments.value,
      results: evalData.value.results.map(r => ({
        id: r.id,
        question: r.question,
        category: r.category,
        difficulty: r.difficulty,
        answer: r.answer,
        ground_truth: r.ground_truth,
        ragas: r.metrics,
        humanScore: humanScores.value[r.id] || null,
        comment: comments.value[r.id] || ''
      }))
    };

    const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `human-scores-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function prevItem() {
    if (currentIndex.value > 0) currentIndex.value--;
  }

  function nextItem() {
    if (evalData.value && currentIndex.value < evalData.value.results.length - 1) currentIndex.value++;
  }

  return {
    evalData,
    currentIndex,
    humanScores,
    comments,
    loading,
    currentItem,
    stats,
    currentReportId,
    importedReports,
    saving,
    serverError,
    loadImportedReports,
    selectImportedReport,
    importFile,
    saveScores,
    setScore,
    exportScores,
    prevItem,
    nextItem,
  };
}
