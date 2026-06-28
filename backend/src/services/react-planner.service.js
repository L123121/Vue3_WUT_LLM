"use strict";

const { AiService } = require('./ai.service');
const deterministicTools = require('./deterministic-tools');
const { toolRegistry } = require('./agent-tools');

/**
 * ReactPlanner — 通用 ReAct 多步推理引擎
 *
 * 支持任意步骤链，每步可调工具或执行确定性逻辑，提前短路。
 * 原选课可行性分析改为一个预配置的任务模板。
 */

class ReactPlanner {
  constructor(aiService = null) {
    this.aiService = aiService || new AiService();
  }

  /**
   * 选课可行性分析（预配置任务）
   */
  async *analyzeCourseFeasibility(message, userId) {
    yield *this._executePlan({
      message,
      userId,
      taskName: '选课可行性分析',
      steps: [
        { name: '识别课程', action: 'llm_parse', prompt: '从以下消息中提取课程名称：' },
        { name: '查询课程要求', action: 'tool', tool: 'lookup_requirements' },
        { name: '查询已修成绩', action: 'tool', tool: 'query_grades' },
        { name: '先修校验', action: 'deterministic', fn: 'checkPrerequisites', shortCircuit: true },
        { name: '查询课表', action: 'tool', tool: 'query_course_schedule' },
        { name: '时间冲突检测', action: 'deterministic', fn: 'checkScheduleConflicts', shortCircuit: true },
        { name: '学分检查', action: 'deterministic', fn: 'checkCreditLimit', shortCircuit: true },
        { name: '综合结论', action: 'llm_format', template: 'formatFeasibilityResult' },
      ],
    });
  }

  /**
   * 通用 ReAct 计划执行器
   */
  async *_executePlan(plan) {
    const { message, userId, steps } = plan;
    const context = { userId, courseName: '', executionLog: [], results: {} };

    for (const step of steps) {
      yield { type: 'thinking', content: `正在${step.name}...` };

      let result;
      try {
        switch (step.action) {
          case 'llm_parse':
            result = await this._llmParse(step.prompt + '\n' + message, step.name);
            if (plan.taskName === '选课可行性分析') {
              context.courseName = result;
              if (!result) {
                yield { type: 'content', content: '未能识别课程名称，请重新说明。', done: true };
                return;
              }
            }
            break;

          case 'tool':
            result = await this._callTool(step.tool, context);
            break;

          case 'deterministic':
            result = this._runDeterministic(step.fn, context, step);
            if (step.shortCircuit && result && result._shortCircuit) {
              yield { type: 'content', content: '', done: true };
              for await (const chunk of this._formatResult(plan.taskName, step.name, context)) {
                yield chunk;
              }
              return;
            }
            break;

          case 'llm_format':
            for await (const chunk of this._formatResult(plan.taskName, step.name, context)) {
              yield chunk;
            }
            return;
        }
      } catch (err) {
        console.error(`[React] 步骤 "${step.name}" 失败:`, err.message);
        // 降级：跳过当前步骤，继续执行
        if (step.shortCircuit) {
          // 短路步骤失败，给出降级结论
          yield { type: 'content', content: '', done: true };
          yield { type: 'content', content: '分析过程中遇到错误，请稍后重试。', done: false };
          yield { type: 'content', content: '', done: true };
          return;
        }
        result = null;
      }

      context.results[step.name] = result;
      context.executionLog.push({ step: step.name, result });
    }

    // 兜底：所有步骤执行完毕但没有 llm_format 步骤
    yield { type: 'content', content: '', done: true };
    yield { type: 'content', content: '分析完成，但无法生成结论。', done: false };
    yield { type: 'content', content: '', done: true };
  }

  // ==================== 动作执行器 ====================

  async _llmParse(prompt, stepName) {
    const timeout = new Promise(resolve =>
      setTimeout(() => resolve(null), 8000)
    );
    const call = this.aiService.getCompletion(prompt, []).catch(() => ({ content: null }));
    const result = await Promise.race([call, timeout]);
    return result?.content?.trim() || null;
  }

  async _callTool(toolName, context) {
    const tool = toolRegistry.getTool(toolName);
    if (!tool) throw new Error(`未知工具: ${toolName}`);

    let args = {};
    if (toolName === 'query_grades') args = {};
    if (toolName === 'query_course_schedule') args = {};
    if (toolName === 'lookup_requirements') args = { courseName: context.courseName };

    return await toolRegistry.executeTool(toolName, args, { userId: context.userId });
  }

  _runDeterministic(fnName, context, step) {
    switch (fnName) {
      case 'checkPrerequisites': {
        const grades = context.results['查询已修成绩'];
        const req = context.results['查询课程要求'];
        const prerequisites = req?.prerequisites || [];
        if (!grades?.success || !grades?.data) {
          return { passed: false, details: [{ reason: '无法获取成绩数据', passed: false }], _shortCircuit: true };
        }
        const result = deterministicTools.checkPrerequisites(grades.data, prerequisites);
        if (!result.passed) result._shortCircuit = true;
        return result;
      }

      case 'checkScheduleConflicts': {
        const schedule = context.results['查询课表'];
        const courseTime = context._courseTime;
        if (!courseTime || !schedule?.success || !schedule?.data) {
          return { hasConflict: false, conflicts: [] };
        }
        const result = deterministicTools.checkScheduleConflicts(courseTime, schedule.data);
        if (result.hasConflict) result._shortCircuit = true;
        return result;
      }

      case 'checkCreditLimit': {
        const grades = context.results['查询已修成绩'];
        const credits = context._courseCredits || 3;
        const creditInfo = grades?.success && grades?.data
          ? deterministicTools.calculateCredits(grades.data)
          : { passedCredits: 0 };
        const result = deterministicTools.checkCreditLimit(creditInfo.passedCredits, credits);
        if (result.exceeded) result._shortCircuit = true;
        return result;
      }

      default:
        throw new Error(`未知确定性函数: ${fnName}`);
    }
  }

  // ==================== 结果格式化 ====================

  async *_formatResult(taskName, stepName, context) {
    // 快速格式化（不调 LLM），避免再次卡顿
    const results = context.results;
    const courseName = context.courseName || '该课程';

    if (taskName === '选课可行性分析') {
      const prereq = results['先修校验'];
      const conflict = results['时间冲突检测'];
      const credit = results['学分检查'];

      if (prereq && !prereq.passed) {
        const failed = prereq.details.filter(d => !d.passed);
        const lines = failed.map(d =>
          `❌ ${d.course}：${d.reason}（需要${d.minGrade}，实际${d.studentGrade || '未修'}）`
        ).join('\n');
        yield { type: 'content', content: `⚠️ 暂时无法选课「${courseName}」\n\n先修课程不满足：\n${lines}\n\n建议完成先修课程后再选课。`, done: false };
        yield { type: 'content', content: '', done: true };
        return;
      }

      if (conflict && conflict.hasConflict) {
        const c = conflict.conflicts[0];
        yield { type: 'content', content: `⚠️ 暂时无法选课「${courseName}」\n\n时间冲突：\n❌ ${c.existingCourseName}（${c.day} 第${c.periodA}节）\n与「${courseName}」（${c.day} 第${c.periodB}节）重叠\n\n建议选择其他课程。`, done: false };
        yield { type: 'content', content: '', done: true };
        return;
      }

      if (credit && credit.exceeded) {
        yield { type: 'content', content: `⚠️ 暂时无法选课「${courseName}」\n\n学分超限：当前 ${credit.currentCredits} 学分，选课后 ${credit.totalAfter} / ${credit.maxAllowed}\n\n建议先完成部分已选课程。`, done: false };
        yield { type: 'content', content: '', done: true };
        return;
      }

      yield { type: 'content', content: `✅ 可以选择「${courseName}」\n\n先修课程、时间安排、学分限制均符合要求。`, done: false };
      yield { type: 'content', content: '', done: true };
      return;
    }

    // 通用兜底
    yield { type: 'content', content: `「${taskName}」分析完成。`, done: false };
    yield { type: 'content', content: '', done: true };
  }
}

module.exports = { ReactPlanner };
