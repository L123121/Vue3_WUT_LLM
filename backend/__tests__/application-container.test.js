import { describe, expect, it } from 'vitest';

const { createApplicationContainer } = require('../src/bootstrap/container');

describe('application container', () => {
  it('允许在组合根替换应用服务依赖', () => {
    const dependencies = {
      aiService: { name: 'ai' },
      ragService: { name: 'rag' },
      memoryService: { name: 'memory' },
      intentRouter: { name: 'intent' },
      agentService: { name: 'agent' },
      conversationOrchestrator: { name: 'conversation' },
      audioService: { name: 'audio' },
    };

    expect(createApplicationContainer(dependencies)).toEqual(dependencies);
  });
});
