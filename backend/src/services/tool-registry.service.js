"use strict";

/**
 * ToolRegistry — 动态工具注册表（V2.0 移植自存档版，裁剪去教务/Redis 依赖）
 *
 * 管理 Agent 可用的所有工具，支持运行时注册/移除/开关。
 * 工具来源 (source): builtin | custom
 */

const TOOL_SOURCES = {
  BUILTIN: 'builtin',
  CUSTOM: 'custom',
};

// 默认单工具执行超时（毫秒）。慢工具不应拖死整轮调度——
// 超时后返回"工具执行超时"字符串（而非 reject），让 LLM 基于已有信息继续。
const DEFAULT_TOOL_TIMEOUT_MS = 8000;

/**
 * 工具超时专用错误。用 instanceof 判定，避免靠魔法字符串 message 比较。
 */
class ToolTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`__TOOL_TIMEOUT__:${timeoutMs}`);
    this.name = 'ToolTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * 给一个 Promise 套上超时：到点 reject(ToolTimeoutError)。
 * 超时后原 promise 仍在后台运行：附加 .catch 兜底，防止 unhandledRejection。
 */
function withTimeout(promise, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ToolTimeoutError(timeoutMs)), timeoutMs);
  });
  const raced = Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  promise
    .then(
      () => { /* 超时后成功完成，结果被丢弃 */ },
      (e) => { console.warn('[ToolRegistry] 超时后 handler 最终失败:', e?.message || e); }
    )
    .catch(() => { /* then 内已处理，这里仅防 then 抛错 */ });
  return raced;
}

class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  /**
   * 注册一个工具
   * @param {Object} tool
   * @param {string} tool.name - 工具名（唯一标识）
   * @param {string} tool.description - 工具描述（给 LLM 看）
   * @param {Object} tool.parameters - JSON Schema 格式参数定义
   * @param {Function} tool.handler - async (args, context) => string
   * @param {string} [tool.category='general'] - 分类标签
   * @param {string} [tool.source='custom'] - 来源
   * @param {boolean} [tool.enabled=true] - 是否启用
   */
  register(tool) {
    if (!tool.name || !tool.handler) {
      throw new Error('工具必须包含 name 和 handler');
    }
    this.tools.set(tool.name, {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.parameters || { type: 'object', properties: {} },
      handler: tool.handler,
      category: tool.category || 'general',
      source: tool.source || TOOL_SOURCES.CUSTOM,
      enabled: tool.enabled !== false,
      timeoutMs: tool.timeoutMs || DEFAULT_TOOL_TIMEOUT_MS,
      registeredAt: new Date(),
    });
  }

  /**
   * 移除一个工具
   * @param {string} name
   * @returns {boolean} 是否成功移除
   */
  unregister(name) {
    return this.tools.delete(name);
  }

  /**
   * 切换工具启用/禁用
   * @param {string} name
   * @param {boolean} enabled
   */
  setEnabled(name, enabled) {
    const tool = this.tools.get(name);
    if (tool) tool.enabled = enabled;
  }

  /**
   * 获取单个工具
   * @param {string} name
   * @returns {Object|null}
   */
  getTool(name) {
    return this.tools.get(name) || null;
  }

  /**
   * 获取所有工具（含禁用的）
   * @returns {Array}
   */
  getAllTools() {
    return Array.from(this.tools.values());
  }

  /**
   * 获取所有启用的工具
   * @returns {Array}
   */
  getEnabledTools() {
    return this.getAllTools().filter(t => t.enabled);
  }

  /**
   * 生成 LLM tools 参数格式（仅启用的工具）
   * @returns {Array}
   */
  getToolSchemas() {
    return this.getEnabledTools().map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /**
   * 获取工具名称列表（仅启用的）
   * @returns {string[]}
   */
  getToolNames() {
    return this.getEnabledTools().map(t => t.name);
  }

  /**
   * 执行指定工具
   * @param {string} name - 工具名称
   * @param {Object} args - 工具参数
   * @param {Object} context - 用户上下文
   * @returns {Promise<string>}
   */
  async executeTool(name, args, context = {}) {
    const tool = this.tools.get(name);
    if (!tool) return `未知工具: ${name}`;
    if (!tool.enabled) return `工具 ${name} 已禁用`;
    const timeoutMs = tool.timeoutMs || DEFAULT_TOOL_TIMEOUT_MS;
    try {
      // 超时不 reject——返回语义化提示，让 LLM 能基于已有信息继续
      return await withTimeout(tool.handler(args, context), timeoutMs);
    } catch (err) {
      if (err instanceof ToolTimeoutError) {
        console.warn(`[ToolRegistry] 工具 ${name} 执行超时（${timeoutMs}ms），返回超时提示`);
        return `工具 ${name} 执行超时（${timeoutMs}ms）。请基于已有信息继续回答，或换一种方式获取数据。`;
      }
      return `工具 ${name} 执行失败: ${err.message}`;
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const all = this.getAllTools();
    return {
      total: all.length,
      enabled: all.filter(t => t.enabled).length,
      bySource: {
        builtin: all.filter(t => t.source === TOOL_SOURCES.BUILTIN).length,
        custom: all.filter(t => t.source === TOOL_SOURCES.CUSTOM).length,
      },
      names: this.getToolNames(),
    };
  }
}

module.exports = { ToolRegistry, TOOL_SOURCES, ToolTimeoutError, DEFAULT_TOOL_TIMEOUT_MS };
