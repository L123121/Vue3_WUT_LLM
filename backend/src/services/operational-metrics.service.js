'use strict';

const MAX_SAMPLES = 2000;

const numberEnv = (name, fallback) => {
  const value = Number.parseFloat(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

const pushBounded = (list, value) => {
  list.push(value);
  if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES);
};

const percentile = (values, ratio) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
};

const localDayKey = (timestamp) => {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const estimateLlmCost = (promptTokens, completionTokens) => (
  promptTokens * numberEnv('AI_INPUT_COST_CNY_PER_MILLION', 0) / 1_000_000
  + completionTokens * numberEnv('AI_OUTPUT_COST_CNY_PER_MILLION', 0) / 1_000_000
);

const createOperationalMetrics = (options = {}) => {
  const now = options.now || Date.now;
  const requests = [];
  const llmUsage = [];
  const ttsUsage = [];
  const alertState = new Map();
  const totals = {
    requests: 0,
    requestErrors: 0,
    llmCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    llmCostCny: 0,
    ttsCalls: 0,
    ttsCharacters: 0,
    ttsCostCny: 0,
  };
  let daily = { date: localDayKey(now()), estimatedCostCny: 0 };

  const ensureDaily = (timestamp = now()) => {
    const date = localDayKey(timestamp);
    if (daily.date !== date) daily = { date, estimatedCostCny: 0 };
    return daily;
  };

  const emitAlert = (key, message, details) => {
    const timestamp = now();
    if (timestamp - (alertState.get(key) || 0) < 60_000) return;
    alertState.set(key, timestamp);
    console.warn(`[OpsAlert] ${message}`, details);
  };

  const checkAlerts = () => {
    const timestamp = now();
    const recent = requests.filter((item) => timestamp - item.timestamp < 5 * 60_000);
    if (recent.length) {
      const errorRate = recent.filter((item) => item.statusCode >= 500).length / recent.length;
      if (errorRate >= numberEnv('OPS_ALERT_ERROR_RATE', 0.1)) emitAlert('error-rate', 'HTTP 错误率超过阈值', { errorRate, total: recent.length });
      const p95 = percentile(recent.map((item) => item.durationMs), 0.95);
      if (p95 >= numberEnv('OPS_ALERT_P95_MS', 3000)) emitAlert('latency', 'HTTP P95 延迟超过阈值', { p95, total: recent.length });
    }
    const currentDaily = ensureDaily(timestamp);
    if (currentDaily.estimatedCostCny >= numberEnv('OPS_ALERT_DAILY_COST_CNY', Number.POSITIVE_INFINITY)) {
      emitAlert('daily-cost', '当日模型成本超过阈值', { dailyCost: currentDaily.estimatedCostCny });
    }
  };

  return {
    recordRequest({ method, path, statusCode, durationMs, traceId }) {
      const timestamp = now();
      totals.requests += 1;
      if (statusCode >= 500) totals.requestErrors += 1;
      pushBounded(requests, { timestamp, method, path, statusCode, durationMs, traceId: traceId || null });
      checkAlerts();
    },
    recordError(error, context = {}) {
      console.error('[OpsError]', { message: error?.message, stack: error?.stack, ...context });
    },
    recordLlmUsage({ model, usage, traceId, latencyMs = 0 }) {
      if (!usage) return;
      const timestamp = now();
      const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
      const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
      const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens) || 0;
      const estimatedCostCny = estimateLlmCost(promptTokens, completionTokens);
      totals.llmCalls += 1;
      totals.promptTokens += promptTokens;
      totals.completionTokens += completionTokens;
      totals.llmCostCny += estimatedCostCny;
      ensureDaily(timestamp).estimatedCostCny += estimatedCostCny;
      pushBounded(llmUsage, { timestamp, model: model || 'unknown', promptTokens, completionTokens, totalTokens, estimatedCostCny, latencyMs, traceId: traceId || null });
      checkAlerts();
    },
    recordTtsUsage({ model, characters, traceId, latencyMs = 0 }) {
      const timestamp = now();
      const count = Number(characters) || 0;
      const estimatedCostCny = count * numberEnv('TTS_COST_CNY_PER_10K_CHARS', 0) / 10_000;
      totals.ttsCalls += 1;
      totals.ttsCharacters += count;
      totals.ttsCostCny += estimatedCostCny;
      ensureDaily(timestamp).estimatedCostCny += estimatedCostCny;
      pushBounded(ttsUsage, { timestamp, model: model || 'unknown', characters: count, estimatedCostCny, latencyMs, traceId: traceId || null });
      checkAlerts();
    },
    snapshot() {
      const durations = requests.map((item) => item.durationMs);
      const currentDaily = ensureDaily(now());
      return {
        requests: { total: totals.requests, errors: totals.requestErrors, p50Ms: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95) },
        llm: { total: totals.llmCalls, promptTokens: totals.promptTokens, completionTokens: totals.completionTokens, estimatedCostCny: totals.llmCostCny, recent: llmUsage.slice(-100) },
        tts: { total: totals.ttsCalls, characters: totals.ttsCharacters, estimatedCostCny: totals.ttsCostCny, recent: ttsUsage.slice(-100) },
        daily: { ...currentDaily },
        estimatedCostCny: totals.llmCostCny + totals.ttsCostCny,
      };
    },
  };
};

const operationalMetrics = createOperationalMetrics();

module.exports = { createOperationalMetrics, operationalMetrics };
