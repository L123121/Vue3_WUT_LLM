'use strict';

const { AiService } = require('../services/ai.service');
const { RagService } = require('../services/rag.service');
const { MemoryService } = require('../services/memory.service');
const { IntentRouter } = require('../services/intent-router.service');
const { AgentService } = require('../services/agent.service');
const { ConversationOrchestrator } = require('../services/conversation-orchestrator.service');
const { audioService } = require('../services/audio.service');

function createApplicationContainer(overrides = {}) {
  const aiService = overrides.aiService || new AiService();
  const ragService = overrides.ragService || new RagService(aiService);
  const memoryService = overrides.memoryService || new MemoryService();
  const intentRouter = overrides.intentRouter || new IntentRouter(aiService);
  const agentService = overrides.agentService || new AgentService(aiService);
  const conversationOrchestrator = overrides.conversationOrchestrator || new ConversationOrchestrator({
    aiService,
    ragService,
    memoryService,
    intentRouter,
    agentService,
  });

  return {
    aiService,
    ragService,
    memoryService,
    intentRouter,
    agentService,
    conversationOrchestrator,
    audioService: overrides.audioService || audioService,
  };
}

const applicationContainer = createApplicationContainer();

module.exports = { createApplicationContainer, applicationContainer };
