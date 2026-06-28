"use strict";

/**
 * Agent 路径处理器
 *
 * 从 AgentService 中提取的三个独立处理路径：
 * - handleSimple: 单轮工具调用（成绩、课表、考试）
 * - handleKnowledge: 知识库检索 + LLM 回答
 * - handleChat: 普通 LLM 对话
 *
 * 每个处理器都是 async generator，通过 ctx 参数访问 AgentService 的工具方法。
 */

const { toolRegistry } = require('./agent-tools');

/**
 * Simple 路径：单轮工具调用
 * 适用于意图明确、工具调用路径固定的查询（成绩、课表、考试）
 */
async function* handleSimple(message, history, routing, userId, skillPrompt, ctx) {
  const toolName = routing.tool;
  if (!toolName) {
    yield* handleChat(message, history, userId, skillPrompt, '', ctx);
    return;
  }

  const args = ctx.buildToolArgs(toolName, message, routing.params);
  const toolCallId = ctx.genId();

  yield {
    type: 'tool_call',
    tool_call: {
      id: toolCallId,
      name: toolName,
      arguments: JSON.stringify(args),
    }
  };

  console.log(`[Agent:Simple] 执行工具: ${toolName}(${JSON.stringify(args).substring(0, 80)})`);

  const result = await toolRegistry.executeTool(toolName, args, { userId });
  const fullResult = typeof result === 'string' ? result : JSON.stringify(result);

  yield {
    type: 'tool_result',
    tool_result: {
      id: toolCallId,
      name: toolName,
      content: fullResult,
      status: 'done',
    }
  };

  // 数据查询类直接返回，跳过 LLM 润色
  const directTools = ['query_grades', 'query_course_schedule', 'query_exam_schedule'];
  if (directTools.includes(toolName)) {
    yield* ctx.streamContent(fullResult);
    ctx.saveMemory(userId, message, fullResult);
  } else {
    yield { type: 'thinking', content: '正在整理结果...' };
    const polished = await ctx.polishResult(toolName, fullResult, message, skillPrompt);
    yield* ctx.streamContent(polished);
    ctx.saveMemory(userId, message, polished);
  }
}

/**
 * Knowledge 路径：知识库检索 + LLM 回答
 */
async function* handleKnowledge(message, history, routing, userId, skillPrompt, ctx) {
  const args = { query: message };
  if (routing.params?.topic) {
    args.query = `${routing.params.topic}：${message}`;
  }

  yield {
    type: 'tool_call',
    tool_call: { id: ctx.genId(), name: 'search_knowledge_base', arguments: JSON.stringify(args) }
  };

  const result = await toolRegistry.executeTool('search_knowledge_base', args, { userId });
  const fullResult = typeof result === 'string' ? result : JSON.stringify(result);

  yield {
    type: 'tool_result',
    tool_result: { id: ctx.genId(), name: 'search_knowledge_base', content: fullResult }
  };

  const polished = await ctx.polishResult('search_knowledge_base', fullResult, message, skillPrompt);
  yield* ctx.streamContent(polished);
  ctx.saveMemory(userId, message, polished);
}

/**
 * Chat 路径：普通 LLM 对话（不使用工具）
 */
async function* handleChat(message, history, userId, skillPrompt, memoryContext, ctx) {
  const systemPrompt = ctx.buildSystemPrompt(skillPrompt, memoryContext);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-10).map(h => ({
      role: h.role === 'assistant' ? 'assistant' : 'user',
      content: h.content,
    })),
    { role: 'user', content: message }
  ];

  if (!ctx.aiService.apiKey) {
    const mock = ctx.aiService.getMockResponse(message);
    yield* ctx.streamContent(mock);
    ctx.saveMemory(userId, message, mock);
    return;
  }

  try {
    const response = await ctx.callLLM(messages);

    if (response.content) {
      yield* ctx.streamContent(response.content);
      ctx.saveMemory(userId, message, response.content);
    } else {
      yield* ctx.streamContent('抱歉，我暂时无法回答这个问题。');
    }
  } catch (err) {
    console.error('[Agent:Chat] LLM 调用失败:', err.message);
    yield* ctx.streamContent('抱歉，服务暂时不可用，请稍后再试。');
  }
}

module.exports = { handleSimple, handleKnowledge, handleChat };
