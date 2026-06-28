"use strict";

/**
 * ToolRegistry — 动态工具注册表
 *
 * 管理 Agent 可用的所有工具，支持运行时注册/移除。
 * 工具来源 (source): builtin | mcp | custom | school
 */

const TOOL_SOURCES = {
  BUILTIN: 'builtin',
  MCP: 'mcp',
  CUSTOM: 'custom',
  SCHOOL: 'school',
};

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
    if (tool) {
      tool.enabled = enabled;
    }
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
   * 按来源获取工具
   * @param {string} source
   * @returns {Array}
   */
  getToolsBySource(source) {
    return this.getAllTools().filter(t => t.source === source);
  }

  /**
   * 按分类获取工具
   * @param {string} category
   * @returns {Array}
   */
  getToolsByCategory(category) {
    return this.getAllTools().filter(t => t.category === category);
  }

  /**
   * 获取所有分类
   * @returns {string[]}
   */
  getCategories() {
    const cats = new Set(this.getAllTools().map(t => t.category));
    return Array.from(cats);
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
    try {
      return await tool.handler(args, context);
    } catch (err) {
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
        mcp: all.filter(t => t.source === TOOL_SOURCES.MCP).length,
        custom: all.filter(t => t.source === TOOL_SOURCES.CUSTOM).length,
        school: all.filter(t => t.source === TOOL_SOURCES.SCHOOL).length,
      },
      categories: this.getCategories(),
    };
  }
}

module.exports = { ToolRegistry, TOOL_SOURCES };
