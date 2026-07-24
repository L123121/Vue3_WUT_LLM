import { describe, it, expect, vi } from 'vitest';

function getEmbeddingService() {
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/services/embedding.service')];
  return require('../src/services/embedding.service').EmbeddingService;
}

describe('EmbeddingService', () => {
  it('查询 embedding 固定使用本地 BGE-small-zh，不再调用远程 API', async () => {
    const previousModel = process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_MODEL;

    try {
      const EmbeddingService = getEmbeddingService();
      const service = new EmbeddingService();
      service._localHybridEmbed = vi.fn().mockResolvedValue({
        dense: [1, 0, 0],
        sparse: { 1: 1 },
        model: 'BGE-small-zh:local-onnx',
        dimensions: 3,
      });

      const result = await service.embedHybrid('校历');

      expect(service.model).toBe('Xenova/bge-small-zh-v1.5');
      expect(service._callApiBatch).toBeUndefined();
      expect(service._localHybridEmbed).toHaveBeenCalledWith('校历');
      expect(result.model).toBe('BGE-small-zh:local-onnx');
    } finally {
      if (previousModel === undefined) {
        delete process.env.EMBEDDING_MODEL;
      } else {
        process.env.EMBEDDING_MODEL = previousModel;
      }
    }
  });
});
