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

// 对话历史窗口长度（与前端 useStreaming.buildHistory 的 -20 对齐）
const HISTORY_WINDOW = 20;

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

  const _t0 = Date.now();
  let result, toolErr;
  try {
    result = await toolRegistry.executeTool(toolName, args, { userId });
  } catch (err) {
    toolErr = err;
    result = `工具执行出错: ${err.message}`;
  }
  if (ctx.tracer) {
    ctx.tracer.recordToolCall(toolName, args, Date.now() - _t0, !toolErr, toolErr?.message);
  }
  const fullResult = typeof result === 'string' ? result : JSON.stringify(result);

  yield {
    type: 'tool_result',
    tool_result: {
      id: toolCallId,
      name: toolName,
      content: fullResult,
      status: 'done',
      durationMs: Date.now() - _t0,
    }
  };

  // ---- query_grades 特殊处理：检测到"未评教"时自动触发成绩回填 ----
  if (toolName === 'query_grades' && /未评教|N\/A/i.test(fullResult)) {
    console.log('[Agent:Simple] 检测到未评教成绩，自动触发隐藏成绩回填...');
    const backfillId = ctx.genId();
    yield {
      type: 'tool_call',
      tool_call: { id: backfillId, name: 'query_ungraded_scores', arguments: JSON.stringify(args) }
    };
    // 工具执行可能抛异常（接口 500/超时等），需捕获后走"使用原始成绩"降级路径，
    // 否则已 yield 的 tool_call 没有 tool_result，前端工具匹配会卡住
    let backfillResult;
    let backfillFailed = false;
    const _bt0 = Date.now();
    let backfillErr;
    try {
      const backfill = await toolRegistry.executeTool('query_ungraded_scores', args, { userId });
      backfillResult = typeof backfill === 'string' ? backfill : JSON.stringify(backfill);
    } catch (err) {
      console.warn('[Agent:Simple] 未评教回填工具执行异常:', err.message);
      backfillResult = '查询失败';
      backfillFailed = true;
      backfillErr = err;
    }
    if (ctx.tracer) {
      ctx.tracer.recordToolCall('query_ungraded_scores', args, Date.now() - _bt0, !backfillFailed, backfillErr?.message);
    }
    yield {
      type: 'tool_result',
      tool_result: { id: backfillId, name: 'query_ungraded_scores', content: backfillResult, status: 'done', durationMs: Date.now() - _bt0 }
    };
    // 回填成功（不含"失败"字样）才合并，否则直接用原始成绩
    if (!backfillFailed && !/失败/i.test(backfillResult)) {
      const combined = fullResult + '\n\n【未评教成绩回填结果】\n' + backfillResult;
      yield { type: 'thinking', content: '正在整理结果...' };
      const polished = await ctx.polishResult(toolName, combined, message, skillPrompt);
      yield* ctx.streamContent(polished);
      ctx.saveMemory(userId, message, polished);
    } else {
      console.warn('[Agent:Simple] 成绩回填失败，使用原始成绩:', backfillResult.substring(0, 100));
      // 把错误信息附加到末尾，不干扰原始成绩
      const note = '\n\n⚠️ 未评教成绩查询暂时不可用，以上显示的是原始成绩数据。';
      yield { type: 'thinking', content: '正在整理结果...' };
      const polished = await ctx.polishResult(toolName, fullResult + note, message, skillPrompt);
      yield* ctx.streamContent(polished);
      ctx.saveMemory(userId, message, polished);
    }
    return;
  }

  // 数据查询类直接返回，跳过 LLM 润色
  // 注意：query_grades 不走 directTools，因为用户常问具体课程（如"计网考的怎么样"），
  // 需要 LLM 润色成自然语言回答而非原始数据转储
  const directTools = ['query_course_schedule', 'query_exam_schedule'];
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

  // tool_call 和 tool_result 必须共享同一 ID，前端依赖此匹配
  const toolCallId = ctx.genId();
  yield {
    type: 'tool_call',
    tool_call: { id: toolCallId, name: 'search_knowledge_base', arguments: JSON.stringify(args) }
  };

  const _t0 = Date.now();
  let result, toolErr;
  try {
    result = await toolRegistry.executeTool('search_knowledge_base', args, { userId });
  } catch (err) {
    toolErr = err;
    result = `工具执行出错: ${err.message}`;
  }
  if (ctx.tracer) {
    ctx.tracer.recordToolCall('search_knowledge_base', args, Date.now() - _t0, !toolErr, toolErr?.message);
  }
  const fullResult = typeof result === 'string' ? result : JSON.stringify(result);

  yield {
    type: 'tool_result',
    tool_result: { id: toolCallId, name: 'search_knowledge_base', content: fullResult, durationMs: Date.now() - _t0 }
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
    ...history.slice(-HISTORY_WINDOW).map(h => ({
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
