"use strict";

const { AiService } = require('./ai.service');
const deterministicTools = require('./deterministic-tools');

/**
 * AnalysisService — 成绩趋势分析模块
 *
 * 对应架构图中的 "成绩趋势分析 → 取数 + LLM 分析" 路径
 *
 * 工作流程：
 * 1. 取数：从教务系统获取结构化成绩数据
 * 2. 计算：用确定性代码做统计分析（GPA趋势、学分分布、排名等）
 * 3. 分析：将统计结果交给 LLM 生成自然语言分析报告
 */

const ANALYSIS_PROMPT = `你是武汉理工大学的学业分析助手。请根据以下学生的成绩统计数据，生成一份专业的中文学业分析报告。

成绩统计数据：
{stats}

要求：
1. 结构清晰，分段落呈现
2. 指出 GPA/成绩的趋势变化（上升/下降/稳定）
3. 指出优势学科和薄弱学科
4. 给出具体的学习建议
5. 语气鼓励性为主，指出进步空间
6. 使用 emoji 增加可读性`;

class AnalysisService {
  constructor(aiService = null) {
    this.aiService = aiService || new AiService();
  }

  /**
   * 分析学生成绩趋势
   *
   * @param {string} userId - 用户 ID
   * @yields {{type: string, content: string, done: boolean}}
   */
  async *analyzeGradeTrend(userId) {
    // ==================== Step 1: 取数 ====================
    yield { type: 'thinking', content: '正在获取您的成绩数据...' };

    const gradesResult = await deterministicTools.getStudentGrades(userId);
    if (!gradesResult.success || !gradesResult.data || gradesResult.data.length === 0) {
      yield { type: 'content', content: '暂无成绩数据可供分析。请先查询成绩或确认已绑定学校账号。', done: true };
      return;
    }

    const grades = gradesResult.data;
    yield { type: 'content', content: `已获取 ${grades.length} 条成绩记录，正在分析...`, done: false };

    // ==================== Step 2: 确定性计算 ====================
    const gpaTrend = deterministicTools.calculateGPATrend(grades);
    const creditDist = deterministicTools.analyzeCreditDistribution(grades);
    const creditInfo = deterministicTools.calculateCredits(grades);

    // 统计最值
    const withNumericGrade = grades.filter(g => g.gradeNumeric !== null);
    const highestGrade = withNumericGrade.length > 0
      ? withNumericGrade.reduce((max, g) => g.gradeNumeric > max.gradeNumeric ? g : max, withNumericGrade[0])
      : null;
    const lowestGrade = withNumericGrade.length > 0
      ? withNumericGrade.reduce((min, g) => g.gradeNumeric < min.gradeNumeric ? g : min, withNumericGrade[0])
      : null;
    const failedCourses = grades.filter(g => g.isPassed === '否' || (g.gradeNumeric !== null && g.gradeNumeric < 60));

    // 构建统计摘要
    const stats = {
      overview: {
        totalCourses: grades.length,
        passedCourses: creditInfo.courseCount,
        totalCredits: creditInfo.passedCredits,
        overallGpa: gpaTrend.length > 0 ? gpaTrend[gpaTrend.length - 1].gpa : 0,
      },
      gpaTrend: gpaTrend.map(t => ({
        semester: t.semester,
        gpa: t.gpa,
        credits: t.credits,
        courses: t.courseCount,
      })),
      creditDistribution: {
        byNature: creditDist.byNature,
        byCategory: creditDist.byCategory,
      },
      highlights: {
        highestGrade: highestGrade ? `${highestGrade.courseName} (${highestGrade.grade})` : 'N/A',
        lowestGrade: lowestGrade ? `${lowestGrade.courseName} (${lowestGrade.grade})` : 'N/A',
        failedCount: failedCourses.length,
        failedCourses: failedCourses.map(g => g.courseName),
      },
    };

    // ==================== Step 3: 生成分析报告（尝试 LLM，失败降级为模板） ====================
    yield { type: 'thinking', content: '正在生成学业分析报告...' };

    // 降级：无论 LLM 成功与否，先生成模板报告
    const mockReport = this._mockAnalysis(stats);

    if (!this.aiService.apiKey) {
      yield *this._streamContent(mockReport);
      return;
    }

    try {
      const prompt = ANALYSIS_PROMPT.replace('{stats}', JSON.stringify(stats, null, 2));
      // 加 20 秒超时
      const response = await Promise.race([
        this.aiService.getCompletion(prompt, []),
        new Promise(resolve => setTimeout(() => resolve({ content: null, _timeout: true }), 20000)),
      ]);

      if (response._timeout || !response.content) {
        yield *this._streamContent(mockReport);
      } else {
        yield *this._streamContent(response.content);
      }
    } catch (err) {
      console.error('[AnalysisService] 分析失败:', err.message);
      yield *this._streamContent(mockReport);
    }
  }

  /**
   * 简单查询：获取各科成绩汇总（不需要 LLM 分析）
   */
  async getGradeSummary(userId) {
    const gradesResult = await deterministicTools.getStudentGrades(userId);
    if (!gradesResult.success || !gradesResult.data) {
      return { success: false, error: gradesResult.error || '获取成绩失败' };
    }

    const creditInfo = deterministicTools.calculateCredits(gradesResult.data);
    const gpaTrend = deterministicTools.calculateGPATrend(gradesResult.data);

    return {
      success: true,
      summary: {
        totalCourses: gradesResult.data.length,
        passedCourses: creditInfo.courseCount,
        totalCredits: creditInfo.passedCredits,
        semesters: gpaTrend,
      },
      grades: gradesResult.data,
    };
  }

  /**
   * 流式输出内容
   */
  async *_streamContent(content) {
    if (!content) {
      yield { type: 'content', content: '', done: true };
      return;
    }
    const chunkSize = 30;
    for (let i = 0; i < content.length; i += chunkSize) {
      yield { type: 'content', content: content.substring(i, i + chunkSize), done: false };
    }
    yield { type: 'content', content: '', done: true };
  }

  _mockAnalysis(stats) {
    const lines = [
      `📊 学业分析报告`,
      ``,
      `总览：共 ${stats.overview.totalCourses} 门课程，通过 ${stats.overview.passedCourses} 门，获得 ${stats.overview.totalCredits} 学分`,
      `当前 GPA：${stats.overview.overallGpa}`,
      ``,
      `📈 GPA 趋势：`,
    ];

    for (const t of stats.gpaTrend) {
      lines.push(`  ${t.semester}: GPA ${t.gpa} (${t.courses} 门课, ${t.credits} 学分)`);
    }

    lines.push(``);
    lines.push(`🏆 最高分：${stats.highlights.highestGrade}`);
    lines.push(`⚠️ 最低分：${stats.highlights.lowestGrade}`);

    if (stats.highlights.failedCount > 0) {
      lines.push(`❌ 不及格课程：${stats.highlights.failedCourses.join('、')}`);
    }

    lines.push(``);
    lines.push('💡 建议：继续保持良好的学习状态，注意薄弱科目的提升。');

    return lines.join('\n');
  }
}

// 导出单例 + 类（兼容不同导入方式）
const { aiService } = require('./ai.service');
const analysisService = new AnalysisService(aiService);
module.exports = { AnalysisService, analysisService };
