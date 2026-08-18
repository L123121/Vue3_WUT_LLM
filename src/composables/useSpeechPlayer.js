import { readonly, ref } from 'vue';
import { synthesizeSpeech } from '../api/audio.js';

const activeMessageId = ref(null);
const isLoading = ref(false);
const chunkIndex = ref(0);
const chunkCount = ref(0);
let currentAudio = null;
let currentObjectUrl = null;
let currentController = null;
let resolveCurrentPlayback = null;
let playbackToken = 0;

export const normalizeReadableText = (value) => String(value || '')
  .replace(/```[\s\S]*?```/g, ' 代码内容已省略。 ')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/https?:\/\/\S+/g, '')
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/^\s*[-*+]\s+/gm, '')
  .replace(/^\s*\d+[.)、]\s+/gm, '')
  .replace(/[>*_~|]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

export const createSpeechPlan = (value, maxChunkLength = 900, maxTotalLength = 4000) => {
  const normalizedText = normalizeReadableText(value);
  const truncated = normalizedText.length > maxTotalLength;
  const text = normalizedText.slice(0, maxTotalLength);
  if (!text) return { chunks: [], truncated: false, originalLength: 0 };

  const sentences = text.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [text];
  const chunks = [];
  let current = '';

  const pushLongSentence = (sentence) => {
    for (let offset = 0; offset < sentence.length; offset += maxChunkLength) {
      chunks.push(sentence.slice(offset, offset + maxChunkLength));
    }
  };

  sentences.forEach((sentence) => {
    const trimmed = sentence.trim();
    if (!trimmed) return;
    if (trimmed.length > maxChunkLength) {
      if (current) chunks.push(current);
      current = '';
      pushLongSentence(trimmed);
      return;
    }
    if (!current) {
      current = trimmed;
      return;
    }
    if (`${current}${trimmed}`.length <= maxChunkLength) {
      current += trimmed;
    } else {
      chunks.push(current);
      current = trimmed;
    }
  });
  if (current) chunks.push(current);
  return { chunks, truncated, originalLength: normalizedText.length };
};

export const splitSpeechText = (value, maxChunkLength = 900, maxTotalLength = 4000) => (
  createSpeechPlan(value, maxChunkLength, maxTotalLength).chunks || []
);

const releaseAudio = () => {
  resolveCurrentPlayback?.();
  resolveCurrentPlayback = null;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.removeAttribute('src');
    currentAudio.load();
    currentAudio = null;
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
};

const stop = () => {
  playbackToken += 1;
  currentController?.abort();
  currentController = null;
  releaseAudio();
  activeMessageId.value = null;
  isLoading.value = false;
  chunkIndex.value = 0;
  chunkCount.value = 0;
};

const playBlob = (blob, token) => new Promise((resolve, reject) => {
  if (token !== playbackToken) return resolve();
  releaseAudio();
  resolveCurrentPlayback = resolve;
  currentObjectUrl = URL.createObjectURL(blob);
  currentAudio = new window.Audio(currentObjectUrl);
  currentAudio.addEventListener('ended', () => {
    resolveCurrentPlayback = null;
    resolve();
  }, { once: true });
  currentAudio.addEventListener('error', () => {
    resolveCurrentPlayback = null;
    reject(new Error('音频播放失败'));
  }, { once: true });
  currentAudio.play().catch(reject);
});

const play = async (messageId, text) => {
  if (activeMessageId.value === messageId) {
    stop();
    return { played: false, truncated: false };
  }

  stop();
  const { chunks, truncated } = createSpeechPlan(text);
  if (chunks.length === 0) throw new Error('没有可朗读的内容');

  const token = playbackToken;
  activeMessageId.value = messageId;
  chunkCount.value = chunks.length;
  currentController = new AbortController();
  const loadChunk = (chunk) => synthesizeSpeech(chunk, { signal: currentController.signal })
    .then((blob) => ({ blob, error: null }))
    .catch((error) => ({ blob: null, error }));

  try {
    let pendingChunk = loadChunk(chunks[0]);
    for (let index = 0; index < chunks.length; index += 1) {
      if (token !== playbackToken) return { played: false, truncated };
      isLoading.value = true;
      chunkIndex.value = index + 1;
      const { blob, error } = await pendingChunk;
      if (error) throw error;
      if (token !== playbackToken) return { played: false, truncated };
      pendingChunk = index + 1 < chunks.length ? loadChunk(chunks[index + 1]) : null;
      isLoading.value = false;
      await playBlob(blob, token);
    }
    return { played: true, truncated };
  } finally {
    if (token === playbackToken) {
      releaseAudio();
      currentController = null;
      activeMessageId.value = null;
      isLoading.value = false;
      chunkIndex.value = 0;
      chunkCount.value = 0;
    }
  }
};

export const useSpeechPlayer = () => ({
  activeMessageId: readonly(activeMessageId),
  isLoading: readonly(isLoading),
  chunkIndex: readonly(chunkIndex),
  chunkCount: readonly(chunkCount),
  play,
  stop,
});
