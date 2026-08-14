import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import VoiceRecorder from '../components/chat/VoiceRecorder.vue';

/**
 * VoiceRecorder 语音识别成功率统计 —— 用假 recognition 模拟会话验证
 *
 * 口径（与组件实现一致）：
 *  - 一次会话（onstart→onend）产出 final 转写 → success+1
 *  - onerror（aborted 用户主动取消除外）→ fail+1
 *  - 无 final 也无 error 的会话 → 不计入
 */

let recognition = null;

class MockSpeechRecognition {
  constructor() {
    this.lang = '';
    this.continuous = false;
    this.interimResults = false;
    this.onstart = null;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    recognition = this;
  }
  start() {}
  stop() {}
  abort() {}
}

// 模拟一次完整会话
// opts: { final: string, error: string, noFinalNoError: boolean }
const runSession = (opts = {}) => {
  if (opts.final !== undefined) {
    recognition.onstart?.();
    const result = { isFinal: true, 0: { transcript: opts.final } };
    result.length = 1;
    recognition.onresult?.({ resultIndex: 0, results: [result] });
  } else if (opts.error) {
    recognition.onstart?.();
    recognition.onerror?.({ error: opts.error });
  } else if (opts.noFinalNoError) {
    recognition.onstart?.();
  }
  recognition.onend?.();
};

const readStats = () => JSON.parse(localStorage.getItem('voice_recognition_stats') || '{"success":0,"fail":0}');

describe('VoiceRecorder 识别成功率统计', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    window.SpeechRecognition = MockSpeechRecognition;
  });

  afterEach(() => {
    delete window.SpeechRecognition;
    recognition = null;
  });

  it('成功会话 +1、no-speech 失败 +1、aborted 不计、空会话不计', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mount(VoiceRecorder);

    // 1. 正常转写成功
    runSession({ final: '你好，武理小精灵' });
    // 2. 第二次成功
    runSession({ final: '今天天气怎么样' });
    // 3. 未检测到语音 → 失败
    runSession({ error: 'no-speech' });
    // 4. 用户主动取消 → 不计失败
    runSession({ error: 'aborted' });
    // 5. 无结果无错误（立即停止）→ 不计
    runSession({ noFinalNoError: true });

    const stats = readStats();
    expect(stats.success).toBe(2);
    expect(stats.fail).toBe(1);

    // 每次有效会话结束应输出 [VoiceStats] 汇总日志
    const logs = consoleSpy.mock.calls.map((c) => c[0]).filter((m) => typeof m === 'string' && m.startsWith('[VoiceStats]'));
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs.at(-1)).toContain('识别成功率: 66.7%');

    consoleSpy.mockRestore();
  });

  it('localStorage 持久化：重新挂载后累计计数不丢失', () => {
    mount(VoiceRecorder);
    runSession({ final: '第一轮' });
    expect(readStats().success).toBe(1);

    // 卸载后重新挂载（模拟刷新页面，localStorage 保留）
    const second = mount(VoiceRecorder);
    runSession({ error: 'network' });
    runSession({ final: '第二轮' });

    const stats = readStats();
    expect(stats.success).toBe(2);
    expect(stats.fail).toBe(1);
    second.unmount();
  });
});
