import { describe, expect, it } from 'vitest';
import { createSpeechPlan, normalizeReadableText, splitSpeechText } from '../composables/useSpeechPlayer.js';

describe('useSpeechPlayer text helpers', () => {
  it('清理 Markdown 与链接后保留可朗读文本', () => {
    expect(normalizeReadableText('## 标题\n- [查看方案](https://example.com)\n`AI` 助手'))
      .toBe('标题 查看方案 AI 助手');
  });

  it('按句子拆分长回答并遵守单段长度', () => {
    const chunks = splitSpeechText('第一句话。第二句话很长。第三句话。', 10, 100);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true);
    expect(chunks.join('')).toContain('第一句话。');
  });

  it('明确标记超过最大朗读长度的回答', () => {
    const plan = createSpeechPlan('一二三四五六七八九十', 4, 8);

    expect(plan.truncated).toBe(true);
    expect(plan.chunks.join('').length).toBe(8);
    expect(plan.originalLength).toBe(10);
  });
});
