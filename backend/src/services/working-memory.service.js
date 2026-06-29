"use strict";

/**
 * WorkingMemory — 跨步骤中间结果容器
 *
 * 解决的问题：
 *   消息历史中的工具结果随着步数增加被稀释或截断，LLM 后续步骤
 *   无法可靠引用早期结果。
 *
 * 设计：
 *   每个用户一次对话请求是一个 turn（回合），每次工具调用是一个 step（步骤）。
 *   步骤结果以结构化 JSON 保存，按工具名/回合可检索。
 *   构建上下文时自动摘要旧步骤，确保不超 token 限制。
 *
 * 生命周期：
 *   WorkingMemory 实例在一次 chatStream 调用中创建，
 *   conversationId 相同时可跨轮引用。
 */

class WorkingMemory {
  /**
   * @param {Object} opts
   * @param {string} opts.userId - 用户 ID
   * @param {string} opts.conversationId - 会话 ID（同一对话可跨轮）
   * @param {number} opts.maxTokens - 构建上下文的 token 估算上限
   * @param {number} opts.maxTurns - 最多保留回合数
   */
  constructor(opts = {}) {
    this.userId = opts.userId || null;
    this.conversationId = opts.conversationId || null;
    this.maxTokens = opts.maxTokens || 3000;
    this.maxTurns = opts.maxTurns || 10;

    /** @type {Array<{id, startedAt, steps: Array}>} */
    this.turns = [];

    /** @type {{id, startedAt, steps: Array}|null} */
    this.currentTurn = null;
  }

  // ==================== 回合管理 ====================

  /**
   * 开启新回合（对应一次用户消息 → Agent 回复的完整过程）
   * @param {string} [turnId] - 可选，不传则自动生成
   */
  startTurn(turnId) {
    this.currentTurn = {
      id: turnId || `turn_${Date.now()}`,
      startedAt: Date.now(),
      steps: [],
      messageCount: 0,
    };
    this.turns.push(this.currentTurn);

    // 限制回合数，淘汰最旧的
    if (this.turns.length > this.maxTurns) {
      this.turns = this.turns.slice(-this.maxTurns);
    }

    return this.currentTurn;
  }

  /**
   * 结束当前回合
   */
  endTurn() {
    if (this.currentTurn) {
      this.currentTurn.endedAt = Date.now();
    }
    this.currentTurn = null;
  }

  // ==================== 步骤记录 ====================

  /**
   * 记录一步工具调用的完整信息
   * @param {string} toolName - 工具名（如 'query_grades'）
   * @param {Object} args - 调用参数
   * @param {*} result - 工具返回结果（保持原始结构）
   * @param {Object} [meta] - 额外元数据
   * @returns {Object} 创建的 step 对象
   */
  recordStep(toolName, args, result, meta = {}) {
    if (!this.currentTurn) {
      this.startTurn();
    }

    const step = {
      id: `step_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      tool: toolName,
      args: this._truncate(args),
      result: this._normalize(result),
      resultSize: this._estimateSize(result),
      timestamp: Date.now(),
      ...meta,
    };

    this.currentTurn.steps.push(step);
    this.currentTurn.messageCount++;

    return step;
  }

  /**
   * LLM 在推理过程中写的工作笔记（scratchpad）
   * 不会触发工具执行，仅记录思考过程
   * @param {string} content - 笔记内容
   * @param {string} [label] - 标签，如 '初步分析' / '中间结论'
   */
  writeNote(content, label = '') {
    return this.recordStep('_note', {}, content, {
      isNote: true,
      label,
      result: content, // 覆盖 result 为笔记内容
    });
  }

  // ==================== 检索 ====================

  /**
   * 用过滤函数查找步骤
   * @param {Function} filterFn - (step) => boolean
   * @returns {Array} 匹配的步骤
   */
  findSteps(filterFn) {
    return this.turns.flatMap(t => t.steps).filter(filterFn);
  }

  /**
   * 按工具名查找所有步骤（跨回合）
   * @param {string} toolName
   * @returns {Array}
   */
  findByTool(toolName) {
    return this.findSteps(s => s.tool === toolName);
  }

  /**
   * 获取指定工具的最新一步（跨回合）
   * @param {string} toolName
   * @returns {Object|null}
   */
  findLatestByTool(toolName) {
    const steps = this.findByTool(toolName);
    return steps.length > 0 ? steps[steps.length - 1] : null;
  }

  /**
   * 获取当前回合的最后 N 步
   * @param {number} n
   * @returns {Array}
   */
  getLastSteps(n = 3) {
    if (!this.currentTurn) return [];
    return this.currentTurn.steps.slice(-n);
  }

  /**
   * 按关键词搜索步骤结果（模糊匹配）
   * @param {string} keyword
   * @returns {Array}
   */
  search(keyword) {
    const kw = keyword.toLowerCase();
    return this.findSteps(s => {
      if (s.tool.includes(kw)) return true;
      if (typeof s.result === 'string' && s.result.toLowerCase().includes(kw)) return true;
      if (typeof s.args === 'object') {
        return JSON.stringify(s.args).toLowerCase().includes(kw);
      }
      return false;
    });
  }

  // ==================== 上下文构建 ====================

  /**
   * 构建 LLM 可读的工作记忆上下文文本
   *
   * 策略：
   *   - 所有笔记（note）全部保留（人类编写的分析，价值高）
   *   - 最近 2 个回合的步骤保留完整
   *   - 更早的回合：每个回合只保留摘要（工具名 + 结果大小）
   *   - 总长度不超过 maxTokens
   *
   * @param {number} [maxTokens] - 覆盖默认值
   * @param {Object} [opts]
   * @param {boolean} [opts.includeAllResults] - 是否包含所有结果（不截断）
   * @returns {string}
   */
  buildContext(maxTokens = this.maxTokens, opts = {}) {
    if (this.turns.length === 0) return '';
    if (this.turns.every(t => t.steps.length === 0)) return '';

    const lines = [];
    const recentCount = 2; // 最近 2 回合保留完整

    lines.push('## 工作记忆（当前对话的历史工具调用结果）');
    lines.push('');

    for (let i = 0; i < this.turns.length; i++) {
      const turn = this.turns[i];
      if (!turn || turn.steps.length === 0) continue;

      const isRecent = i >= this.turns.length - recentCount;
      const turnLabel = i === this.turns.length - 1 ? '当前回合' : `第 ${i + 1} 轮`;

      lines.push(`### ${turnLabel}`);

      for (const step of turn.steps) {
        if (step.isNote) {
          // 笔记：保留全部内容（高价值信息）
          const label = step.label ? ` [${step.label}]` : '';
          lines.push(`  📝 笔记${label}: ${step.result}`);
          continue;
        }

        // 工具调用
        const argsStr = this._formatArgs(step.args);
        lines.push(`  🔧 ${step.tool}(${argsStr})`);

        if (isRecent || opts.includeAllResults) {
          // 最近回合：保留完整结果
          const resultStr = this._formatResultPreview(step.result, 600);
          lines.push(`    结果: ${resultStr}`);
        } else {
          // 早期回合：仅摘要
          lines.push(`    结果: [${step.resultSize} 字符]（可搜索关键词"${step.tool}"引用）`);
        }
      }
      lines.push('');
    }

    lines.push('【工作记忆使用说明】');
    lines.push('1. 你可以通过工具名引用之前步骤的结果，如"上一步 query_grades 返回的数据"');
    lines.push('2. 如果需要记录中间分析结论，调用 _write_note 工具');
    lines.push('3. 早期回合的结果已摘要，如需完整数据请重新调用对应工具');

    let context = lines.join('\n');

    // Token 截断（粗略按 4 字符/token）
    const maxChars = maxTokens * 4;
    if (context.length > maxChars) {
      const keepHead = Math.floor(maxChars * 0.4);
      const keepTail = Math.floor(maxChars * 0.5);
      context = context.substring(0, keepHead)
        + '\n\n...（中间截断，共 ' + this.turns.length + ' 回合）...\n\n'
        + context.substring(context.length - keepTail);
    }

    return context;
  }

  /**
   * 清除所有工作记忆
   */
  clear() {
    this.turns = [];
    this.currentTurn = null;
  }

  // ==================== 序列化 ====================

  toJSON() {
    return {
      userId: this.userId,
      conversationId: this.conversationId,
      turns: this.turns.map(t => ({
        id: t.id,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        steps: t.steps.map(s => ({
          ...s,
          // 对过大结果做截断
          result: typeof s.result === 'string' && s.result.length > 2000
            ? s.result.substring(0, 2000) + '...'
            : s.result,
        })),
      })),
    };
  }

  static fromJSON(data) {
    const wm = new WorkingMemory({
      userId: data.userId,
      conversationId: data.conversationId,
    });
    wm.turns = (data.turns || []).map(t => ({
      ...t,
      steps: t.steps || [],
    }));
    if (wm.turns.length > 0) {
      wm.currentTurn = wm.turns[wm.turns.length - 1];
    }
    return wm;
  }

  // ==================== 内部工具 ====================

  _truncate(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const str = JSON.stringify(obj);
    if (str.length <= 2000) return obj;
    // 只保留第一层 key，对值做截断
    const truncated = {};
    for (const [key, val] of Object.entries(obj)) {
      const valStr = typeof val === 'string' ? val : JSON.stringify(val);
      truncated[key] = valStr.length > 200 ? valStr.substring(0, 200) + '...' : val;
    }
    return truncated;
  }

  _normalize(result) {
    if (typeof result === 'string') return result;
    if (result === null || result === undefined) return '';
    try {
      const str = JSON.stringify(result);
      return str.length > 5000 ? str.substring(0, 5000) + '...' : str;
    } catch {
      return String(result);
    }
  }

  _estimateSize(result) {
    if (typeof result === 'string') return result.length;
    try {
      return JSON.stringify(result).length;
    } catch {
      return String(result).length;
    }
  }

  _formatArgs(args) {
    if (!args || typeof args !== 'object' || Object.keys(args).length === 0) return '';
    return Object.entries(args)
      .map(([k, v]) => {
        const val = typeof v === 'string' ? `"${v.substring(0, 50)}"` : JSON.stringify(v);
        return `${k}=${val}`;
      })
      .join(', ');
  }

  _formatResultPreview(result, maxLen) {
    const str = typeof result === 'string' ? result : JSON.stringify(result);
    if (!str) return '空';
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen) + '...（共' + str.length + '字符）';
  }
}

module.exports = { WorkingMemory };
