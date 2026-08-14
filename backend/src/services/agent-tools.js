"use strict";

/**
 * Agent 工具注册表（V2.0，移植自存档版裁剪）
 *
 * 只保留两个零外部依赖的工具：
 *   - search_knowledge_base：知识库 RAG 检索（复用 rag.service）
 *   - calculate：数学计算（mathjs 安全求值）
 * 教务系工具（查成绩/课表等）因当前项目无教务系统接入，不移植。
 */

const { ToolRegistry, TOOL_SOURCES } = require('./tool-registry.service');
const { RagService } = require('./rag.service');
const { aiService } = require('./ai.service');
const { create, all } = require('mathjs');

const ragService = new RagService(aiService);
const math = create(all);

// 工具执行超时分级：知识库检索走完整 RAG 链路，给 15s；本地计算 3s
const TIMEOUT_SCHOOL = 15000;
const TIMEOUT_LOCAL = 3000;

// ============================================================
// 创建全局注册表并注册内置工具
// ============================================================

const toolRegistry = new ToolRegistry();

const builtinTools = [
  {
    name: 'search_knowledge_base',
    description: '从校园知识库中检索相关信息。当用户询问学校相关问题时使用此工具。支持按类别检索：学校概况、专业课程、面试刷题、AI学习等。',
    category: '知识库',
    source: TOOL_SOURCES.BUILTIN,
    timeoutMs: TIMEOUT_SCHOOL,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '检索关键词或问题'
        },
        category: {
          type: 'string',
          enum: ['学校概况', '专业课程', '面试刷题', 'AI学习', 'general'],
          description: '知识库分类（可选）'
        }
      },
      required: ['query']
    },
    handler: async (args) => {
      try {
        const result = await ragService.chat(args.query, [], { category: args.category });
        if (!result || !result.reply) return '知识库中未找到相关信息';
        const sources = result.sources?.map(s => s.title).join(', ') || '无';
        return `检索结果：${result.reply}\n来源：${sources}`;
      } catch (err) {
        return `知识库检索失败：${err.message}`;
      }
    }
  },

  {
    name: 'calculate',
    description: '执行数学计算。支持加减乘除、乘方、开方、三角函数等。当用户需要计算时使用。',
    category: '工具',
    source: TOOL_SOURCES.BUILTIN,
    timeoutMs: TIMEOUT_LOCAL,
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: '数学表达式，如 "2+3*4", "sqrt(16)", "sin(3.14/2)"'
        }
      },
      required: ['expression']
    },
    handler: async (args) => {
      try {
        const expr = args.expression;
        // 使用 mathjs 安全求值（模块级 create(all) 实例），避免 new Function() 注入风险
        const result = math.evaluate(expr);
        if (typeof result !== 'number' || !isFinite(result)) {
          return `计算结果无效: ${result}`;
        }
        return `${args.expression} = ${result}`;
      } catch (err) {
        return `计算失败: ${err.message}`;
      }
    }
  },
];

for (const t of builtinTools) {
  toolRegistry.register(t);
}

/**
 * 生成 LLM 工具 schema（OpenAI function calling 格式）
 */
function getToolSchemas() {
  return toolRegistry.getToolSchemas();
}

/**
 * 执行工具
 * @param {string} name - 工具名
 * @param {Object} args - 参数
 * @param {Object} context - { userId }
 */
function executeTool(name, args, context = {}) {
  return toolRegistry.executeTool(name, args, context);
}

function getToolNames() {
  return toolRegistry.getToolNames();
}

module.exports = { toolRegistry, getToolSchemas, executeTool, getToolNames };
