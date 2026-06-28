"use strict";

const { AiService } = require('./ai.service');
const { IntentRouter } = require('./intent-router.service');
const { ReactPlanner, REACT_STEPS } = require('./react-planner.service');
const { analysisService } = require('./analysis.service');
const { request } = require('../utils/httpClient');
const { handleSimple, handleKnowledge, handleChat } = require('./agent-handlers');

/**
 * AgentService — 意图路由 + 多路径处理引擎
 *
 * 对应架构图中的核心枢纽：
 *   "用户提问 → NLU意图识别 → 任务路由 → 不同处理路径 → LLM润色 → 回复用户"
 *
 * 处理路径：
 *   simple      → 单轮工具调用（查成绩、查课表、查考试）
 *   react       → ReAct 多步循环（选课可行性分析 + 提前短路）
 *   analysis    → 取数 + LLM 分析（成绩趋势分析）
 *   knowledge   → 知识库检索（校园百科）
 *   chat        → 普通对话
 */

class AgentService {
  constructor(aiService = null) {
    this.aiService = aiService || new AiService();
    this.intentRouter = new IntentRouter(aiService);
    this.reactPlanner = new ReactPlanner(aiService);
    this.analysisService = analysisService;
    this.memoryService = null; // 由 app.js 注入
  }

  /**
   * 构建传递给 handler 的上下文对象
   */
  _buildHandlerCtx() {
    return {
      aiService: this.aiService,
      buildToolArgs: this._buildToolArgs.bind(this),
      genId: this._genId.bind(this),
      streamContent: this._streamContent.bind(this),
      polishResult: this._polishResult.bind(this),
      saveMemory: this._saveMemory.bind(this),
      buildSystemPrompt: this._buildSystemPrompt.bind(this),
      callLLM: this._callLLM.bind(this),
    };
  }

  // ==================== 主入口 ====================

  /**
   * Agent 流式对话 — 意图路由入口
   * 总超时 60 秒，超时后返回错误信息
   */
  async *chatStream(message, history = [], options = {}) {
    const startTime = Date.now();
    const TOTAL_TIMEOUT = 60000;
    const userId = options.userId || null;
    const skillPrompt = options.skillPrompt || '';
    const ctx = this._buildHandlerCtx();

    console.log(`[Agent] 用户消息: "${message.substring(0, 50)}", userId: ${userId || 'anonymous'}`);

    // Phase 0: 加载记忆上下文
    let memoryContext = '';
    if (this.memoryService && userId) {
      try {
        memoryContext = await this.memoryService.buildMemoryContext(userId, message);
        if (memoryContext) console.log(`[Agent] 记忆上下文: ${memoryContext.length} 字符`);
      } catch (err) {
        console.warn('[Agent] 加载记忆失败:', err.message);
      }
    }

    // Phase 1: 意图识别 + 路由
    const routing = await this.intentRouter.route(message);
    if (Date.now() - startTime > TOTAL_TIMEOUT) {
      yield { type: 'content', content: '处理超时，请重试。', done: false };
      yield { type: 'content', content: '', done: true };
      return;
    }
    console.log(`[Agent] 意图: ${routing.intent} → 路径: ${routing.route} (置信度: ${routing.confidence})`);

    yield { type: 'thinking', content: `正在分析：${routing.reason || routing.intent}` };

    // Phase 2: 按路径分发
    try {
      switch (routing.route) {
        case 'simple':
          yield* handleSimple(message, history, routing, userId, skillPrompt, ctx);
          break;
        case 'react':
          try {
            yield* this.reactPlanner.analyzeCourseFeasibility(message, userId);
          } catch (err) {
            console.error('[Agent] React 规划失败，降级为 Simple:', err.message);
            const fallbackRouting = { intent: 'query_grades', tool: 'query_grades', params: {} };
            yield* handleSimple(message, history, fallbackRouting, userId, skillPrompt, ctx);
          }
          break;
        case 'analysis':
          try {
            yield* this.analysisService.analyzeGradeTrend(userId);
          } catch (err) {
            console.error('[Agent] 分析服务失败，降级为成绩查询:', err.message);
            const fallbackRouting = { intent: 'query_grades', tool: 'query_grades', params: {} };
            yield* handleSimple(message, history, fallbackRouting, userId, skillPrompt, ctx);
          }
          break;
        case 'knowledge':
          yield* handleKnowledge(message, history, routing, userId, skillPrompt, ctx);
          break;
        case 'chat':
        default:
          yield* handleChat(message, history, userId, skillPrompt, memoryContext, ctx);
          break;
      }
    } catch (err) {
      console.error('[Agent] 处理异常:', err.message);
      yield { type: 'content', content: `处理出错：${err.message}`, done: false };
      yield { type: 'content', content: '', done: true };
    }

    if (Date.now() - startTime > TOTAL_TIMEOUT) {
      console.warn('[Agent] 总处理超时(60s)');
    }
  }

  // ==================== LLM 调用 ====================

  async _callLLM(messages) {
    const path = this.aiService.anthropicMode ? '/v1/messages' : '/v2/chat/completions';

    const payload = {
      model: this.aiService.model,
      messages,
      max_tokens: this.aiService.maxTokens,
      temperature: this.aiService.temperature,
      stream: false,
    };

    const body = JSON.stringify(payload);
    const options = this.aiService._buildOptions(path);
    options.headers['Content-Length'] = Buffer.byteLength(body, 'utf8');

    try {
      const result = await request(options, body);
      const json = result.data;
      const choice = json?.choices?.[0];
      if (!choice) return { content: '' };

      const message = choice.message;
      return {
        content: message.content || '',
        tool_calls: message.tool_calls || null,
      };
    } catch (err) {
      if (err.statusCode) throw new Error(`LLM 返回 ${err.statusCode}`);
      throw new Error(`LLM 请求失败: ${err.message}`);
    }
  }

  // ==================== 结果润色 ====================

  async _polishResult(toolName, rawResult, userMessage, skillPrompt) {
    if (!this.aiService.apiKey) {
      return rawResult;
    }

    const prompt = `以自然语气回答用户，保留全部关键信息。

用户：${userMessage}

数据：${rawResult.substring(0, 4000)}`;

    try {
      const response = await Promise.race([
        this.aiService.getCompletion(prompt, []),
        new Promise((resolve) =>
          setTimeout(() => resolve({ content: '', isMock: true, _timeout: true }), 15000)
        ),
      ]);
      if (response._timeout) {
        console.warn('[Agent] 润色超时(15s)，返回原始结果');
        return rawResult;
      }
      return response.content || rawResult;
    } catch (err) {
      console.error('[Agent] 润色失败:', err.message);
      return rawResult;
    }
  }

  // ==================== 辅助方法 ====================

  _buildToolArgs(toolName, message, params) {
    switch (toolName) {
      case 'query_grades':
        return { semester: params?.semester || null };
      case 'query_course_schedule':
        return {
          semester: params?.semester || null,
          week: params?.week || null,
          day: params?.day || null,
        };
      case 'query_exam_schedule':
        return { semester: params?.semester || null, course: params?.course || null };
      case 'search_knowledge_base':
        return {
          query: message,
          category: params?.category || 'general',
        };
      default:
        return params || {};
    }
  }

  _buildSystemPrompt(skillPrompt, memoryContext = '') {
    const parts = [
      '你是武汉理工大学的校园 AI 助手（武理小精灵）。',
      '你可以使用工具查询校园信息，也可以直接回答用户问题。',
      '回答时使用中文，语气友好自然。',
      '如果用户的问题涉及具体数据（成绩、课表、考试等），请使用工具查询。',
      '如果用户未绑定账号且需要查询个人数据，提示用户去设置页面绑定。',
    ];

    if (memoryContext) {
      parts.push(`\n## 对话上下文与记忆\n${memoryContext}`);
    }

    if (skillPrompt) {
      parts.push(`\n## 技能规范\n${skillPrompt}`);
    }

    return parts.join('\n');
  }

  async *_streamContent(content) {
    if (!content) {
      yield { type: 'content', content: '', done: true };
      return;
    }

    const chunkSize = 60;
    for (let i = 0; i < content.length; i += chunkSize) {
      yield { type: 'content', content: content.substring(i, i + chunkSize), done: false };
    }
    yield { type: 'content', content: '', done: true };
  }

  async _saveMemory(userId, userMessage, aiReply) {
    if (!this.memoryService || !userId) return;
    try {
      const summary = `${userMessage} → ${(aiReply || '').substring(0, 200)}`;
      await this.memoryService.saveShortTerm(userId, summary);
      await this.memoryService.extractAndSave(userId, userMessage, aiReply);
    } catch (err) {
      console.warn('[Agent] 记忆保存失败:', err.message);
    }
  }

  _genId() {
    return `tc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }
}

module.exports = { AgentService };
