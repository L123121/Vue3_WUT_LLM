"use strict";

const config = require("../config");
const crypto = require("crypto");

const SUPPORTED_MODELS = new Set(["step-tts-2", "step-tts-mini", "stepaudio-2.5-tts"]);
const SUPPORTED_FORMATS = new Set(["wav", "mp3", "flac", "opus", "pcm"]);

function normalizeSpeechText(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, " 代码内容已省略。 ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)、]\s+/gm, "")
    .replace(/[>*_~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

function createAbortContext(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    },
  };
}

class AudioCache {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs || 30 * 60 * 1000;
    this.maxEntries = options.maxEntries || 100;
    this.maxBytes = options.maxBytes || 64 * 1024 * 1024;
    this.entries = new Map();
    this.totalBytes = 0;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    const size = value.buffer.length;
    if (size > this.maxBytes) return;
    this.delete(key);
    this.entries.set(key, {
      value,
      size,
      expiresAt: Date.now() + this.ttlMs,
    });
    this.totalBytes += size;
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value;
      this.delete(oldestKey);
    }
  }

  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.totalBytes -= entry.size;
  }
}

class AudioService {
  constructor(options = {}) {
    this.config = options.config || config.audio;
    this.fetch = options.fetch || globalThis.fetch;
    this.cache = options.cache || new AudioCache({
      ttlMs: this.config.cacheTtlMs,
      maxEntries: this.config.cacheMaxEntries,
      maxBytes: this.config.cacheMaxBytes,
    });
  }

  async synthesize(text, options = {}) {
    if (options.signal?.aborted) {
      const error = new Error("Aborted");
      error.name = "AbortError";
      throw error;
    }
    if (!this.config.apiKey) {
      throw createHttpError("语音服务尚未配置 STEPFUN_API_KEY", 503);
    }
    if (typeof this.fetch !== "function") {
      throw createHttpError("当前运行环境不支持语音请求", 500);
    }

    const input = normalizeSpeechText(text);
    if (!input) throw createHttpError("没有可朗读的文本", 400);
    if (input.length > this.config.maxInputLength) {
      throw createHttpError(`单次朗读不能超过 ${this.config.maxInputLength} 个字符`, 400);
    }

    const model = SUPPORTED_MODELS.has(this.config.model)
      ? this.config.model
      : "stepaudio-2.5-tts";
    const responseFormat = SUPPORTED_FORMATS.has(this.config.responseFormat)
      ? this.config.responseFormat
      : "mp3";
    const payload = {
      model,
      input,
      voice: this.config.voice,
      response_format: responseFormat,
      speed: Number.isFinite(this.config.speed) ? this.config.speed : 1,
      text_normalization: "enhanced",
      markdown_filter: true,
    };
    if (model === "stepaudio-2.5-tts" && this.config.instruction) {
      payload.instruction = this.config.instruction.slice(0, 200);
    }

    const cacheKey = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const cached = this.config.cacheEnabled === false ? null : this.cache.get(cacheKey);
    if (cached) return { ...cached, cacheHit: true };

    const baseUrl = String(this.config.baseUrl || "https://api.stepfun.com/v1").replace(/\/$/, "");
    const abortContext = createAbortContext(options.signal, this.config.timeout || 60000);

    let response;
    try {
      response = await this.fetch(`${baseUrl}/audio/speech`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: abortContext.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        if (options.signal?.aborted && !abortContext.didTimeOut()) throw error;
        throw createHttpError("语音生成超时，请稍后重试", 504);
      }
      throw createHttpError(`语音服务连接失败：${error.message}`, 502);
    } finally {
      abortContext.cleanup();
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(`[Audio] StepFun 请求失败: ${response.status}`, detail.slice(0, 500));
      throw createHttpError("语音生成失败，请稍后重试", 502);
    }

    const result = {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") || `audio/${responseFormat}`,
      format: responseFormat,
      model,
      characters: input.length,
      cacheHit: false,
    };
    if (this.config.cacheEnabled !== false) this.cache.set(cacheKey, result);
    return result;
  }
}

const audioService = new AudioService();

module.exports = { AudioCache, AudioService, audioService, normalizeSpeechText };
