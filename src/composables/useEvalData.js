import { ref, computed } from 'vue';
import { evalApi } from '../api/eval.js';

export function useEvalData() {
  const evalData = ref(null);
  const currentIndex = ref(0);
  const humanScores = ref({});
  const comments = ref({});
  const loading = ref(false);

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

  function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    loading.value = true;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        evalData.value = JSON.parse(e.target.result);
        currentIndex.value = 0;
        if (evalData.value.humanScores) {
          humanScores.value = evalData.value.humanScores;
          comments.value = evalData.value.comments || {};
        }
      } catch (err) {
        alert('JSON 解析失败: ' + err.message);
      } finally {
        loading.value = false;
      }
    };
    reader.readAsText(file);
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
    handleFileUpload,
    setScore,
    exportScores,
    prevItem,
    nextItem,
  };
}
