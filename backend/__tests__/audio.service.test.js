import { describe, expect, it, vi } from 'vitest';

const { AudioService, normalizeSpeechText } = require('../src/services/audio.service');

describe('audio.service', () => {
  it('将 Markdown 回答转换成适合朗读的纯文本', () => {
    const text = normalizeSpeechText('# 标题\n- 查看[培养方案](https://example.com)\n```js\nalert(1)\n```');

    expect(text).toBe('标题 查看培养方案 代码内容已省略。');
  });

  it('调用 StepFun TTS 并返回音频 Buffer', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'audio/mpeg' },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    });
    const service = new AudioService({
      fetch: fetchMock,
      config: {
        apiKey: 'test-key',
        baseUrl: 'https://api.stepfun.com/v1',
        model: 'stepaudio-2.5-tts',
        voice: 'cixingnansheng',
        responseFormat: 'mp3',
        speed: 1,
        instruction: '自然亲切',
        timeout: 1000,
        maxInputLength: 1000,
      },
    });

    const result = await service.synthesize('你好，欢迎使用武理小精灵。');

    expect(result.buffer).toEqual(Buffer.from([1, 2, 3]));
    expect(result.characters).toBe('你好，欢迎使用武理小精灵。'.length);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.stepfun.com/v1/audio/speech',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody).toMatchObject({
      model: 'stepaudio-2.5-tts',
      voice: 'cixingnansheng',
      instruction: '自然亲切',
    });
  });

  it('缓存相同配置与文本的语音结果', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'audio/mpeg' },
      arrayBuffer: async () => Uint8Array.from([4, 5, 6]).buffer,
    });
    const service = new AudioService({
      fetch: fetchMock,
      config: {
        apiKey: 'test-key',
        baseUrl: 'https://api.stepfun.com/v1',
        model: 'stepaudio-2.5-tts',
        voice: 'cixingnansheng',
        responseFormat: 'mp3',
        speed: 1,
        instruction: '自然亲切',
        timeout: 1000,
        maxInputLength: 1000,
        cacheTtlMs: 60000,
        cacheMaxEntries: 10,
        cacheMaxBytes: 1024,
      },
    });

    const first = await service.synthesize('重复朗读内容');
    const second = await service.synthesize('重复朗读内容');

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('外部取消信号会终止正在进行的模型请求', async () => {
    const fetchMock = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }));
    const service = new AudioService({
      fetch: fetchMock,
      config: {
        apiKey: 'test-key',
        baseUrl: 'https://api.stepfun.com/v1',
        model: 'stepaudio-2.5-tts',
        voice: 'cixingnansheng',
        responseFormat: 'mp3',
        speed: 1,
        instruction: '',
        timeout: 10000,
        maxInputLength: 1000,
      },
    });
    const controller = new AbortController();

    const request = service.synthesize('取消这次朗读', { signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('拒绝超过单次模型限制的文本', async () => {
    const service = new AudioService({
      fetch: vi.fn(),
      config: {
        apiKey: 'test-key',
        maxInputLength: 5,
      },
    });

    await expect(service.synthesize('超过五个字符')).rejects.toMatchObject({ statusCode: 400 });
  });
});
