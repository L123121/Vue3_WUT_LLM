"use strict";

const { redis: store } = require('./memory-store');
const schoolApi = require('./school-api.service');
const { ragService } = require('./rag.service');

/**
 * DeterministicTools — 确定性工具层
 *
 * 对应架构图中的 "确定性工具层 (普通代码, 不让 LLM 碰)"
 *
 * 核心理念：
 * - "判断"由代码完成，LLM 只负责驱动"下一步查什么"
 * - 所有函数都是纯计算/纯查询，不包含 LLM 推理
 * - 返回结构化数据（对象），前端可以展示原始数据
 * - 每个函数独立可测试、可验证
 *
 * 分为三类：
 * 1. 教务数据获取（getter）- 从教务系统取原始数据
 * 2. 规则校验（checker）- 基于数据的纯逻辑判断
 * 3. 计算分析（calculator）- 统计、排序、聚合
 */

class DeterministicTools {
  // ==================== 教务数据获取 ====================

  /**
   * 获取学生成绩（结构化数据）
   * @param {string} userId
   * @param {string} semester - 可选学期
   * @returns {Promise<{success: boolean, data?: Array, error?: string}>}
   */
  async getStudentGrades(userId, semester) {
    try {
      const info = await store.hgetall(`school:user:${userId}`);
      if (!info || !info.studentId) {
        return { success: false, error: '用户未绑定学校账号' };
      }

      const grades = await schoolApi.getGrades(userId, semester);
      return { success: true, data: grades };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * 获取学生课表（结构化数据）
   * @param {string} userId
   * @param {string} semester - 可选学期
   * @returns {Promise<{success: boolean, data?: Array, error?: string}>}
   */
  async getStudentSchedule(userId, semester) {
    try {
      const info = await store.hgetall(`school:user:${userId}`);
      if (!info || !info.studentId) {
        return { success: false, error: '用户未绑定学校账号' };
      }

      const schedule = await schoolApi.getSchedule(userId, semester);
      return { success: true, data: schedule };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * 获取可选学期列表
   * @param {string} userId
   * @returns {Promise<{success: boolean, data?: Array, error?: string}>}
   */
  async getAvailableSemesters(userId) {
    try {
      const info = await store.hgetall(`school:user:${userId}`);
      if (!info || !info.studentId) {
        return { success: false, error: '用户未绑定学校账号' };
      }

      const semesters = await schoolApi.getSemesters(userId);
      return { success: true, data: semesters };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ==================== 规则校验（Checkers） ====================

  /**
   * 先修课校验：检查学生是否满足课程的先修要求
   * 这是"确定性判断"的核心 — 代码说了算，LLM 不碰
   *
   * @param {Array} studentGrades - 学生已修成绩 [{courseName, isPassed, gradeNumeric, credits}]
   * @param {Array} prerequisites - 课程先修要求 [{courseName, minGrade}]
   * @returns {Object} { passed: boolean, details: Array }
   */
  checkPrerequisites(studentGrades, prerequisites) {
    if (!prerequisites || prerequisites.length === 0) {
      return { passed: true, details: [{ course: '无', required: false, passed: true, reason: '该课程无先修要求' }] };
    }

    // 建立已修课程查找表（按课程名精确匹配 + 模糊匹配）
    const gradeMap = new Map();
    for (const g of studentGrades) {
      const key = g.courseName;
      if (!gradeMap.has(key) || (g.gradeNumeric && (!gradeMap.get(key).gradeNumeric || g.gradeNumeric > gradeMap.get(key).gradeNumeric))) {
        gradeMap.set(key, g);
      }
    }

    const details = [];
    let allPassed = true;

    for (const req of prerequisites) {
      const grade = gradeMap.get(req.courseName);
      const passed = grade && grade.isPassed && (!req.minGrade || (grade.gradeNumeric && grade.gradeNumeric >= req.minGrade));

      if (!passed) {
        allPassed = false;
      }

      details.push({
        course: req.courseName,
        required: true,
        passed: !!passed,
        studentGrade: grade ? (grade.gradeNumeric || grade.grade) : null,
        minGrade: req.minGrade || '及格',
        reason: passed ? '已修且满足要求' : (grade ? '成绩不达标' : '未修此课程'),
      });
    }

    return { passed: allPassed, details };
  }

  /**
   * 时间冲突检测：检查两个课程的时间是否冲突
   * 基于周次位图 + 节次范围进行精确判断
   *
   * @param {Object} courseA - {weekBitmap, weekDay, startPeriod, endPeriod, courseName}
   * @param {Object} courseB - 同上
   * @returns {Object} { hasConflict: boolean, conflictPeriods: Array }
   */
  checkTimeConflict(courseA, courseB) {
    // 不同天不可能冲突
    if (courseA.weekDay !== courseB.weekDay) {
      return { hasConflict: false, conflictPeriods: [] };
    }

    // 检查周次是否有交集
    const commonWeeks = this._getCommonWeeks(courseA.weekBitmap, courseB.weekBitmap);
    if (commonWeeks.length === 0) {
      return { hasConflict: false, conflictPeriods: [] };
    }

    // 检查节次是否有交集
    const hasPeriodOverlap = courseA.startPeriod <= courseB.endPeriod && courseB.startPeriod <= courseA.endPeriod;
    if (!hasPeriodOverlap) {
      return { hasConflict: false, conflictPeriods: [] };
    }

    return {
      hasConflict: true,
      conflictPeriods: [
        {
          day: courseA.weekDay,
          weeks: commonWeeks,
          periodA: `${courseA.startPeriod}-${courseA.endPeriod}`,
          periodB: `${courseB.startPeriod}-${courseB.endPeriod}`,
          courseA: courseA.courseName,
          courseB: courseB.courseName,
        }
      ]
    };
  }

  /**
   * 批量时间冲突检测：检查一门新课与已有课表的冲突
   * @param {Object} newCourse - 新课
   * @param {Array} existingSchedule - 已有课表
   * @returns {Object} { hasConflict: boolean, conflicts: Array }
   */
  checkScheduleConflicts(newCourse, existingSchedule) {
    const conflicts = [];
    for (const existing of existingSchedule) {
      const result = this.checkTimeConflict(newCourse, existing);
      if (result.hasConflict) {
        conflicts.push({
          ...result.conflictPeriods[0],
          existingCourseName: existing.courseName,
        });
      }
    }
    return {
      hasConflict: conflicts.length > 0,
      conflicts,
      conflictCount: conflicts.length,
    };
  }

  /**
   * 学分计算：统计已修总学分 / 本学期已选学分
   * @param {Array} grades - 成绩列表 [{credits, isPassed}]
   * @returns {Object} { totalCredits: number, passedCredits: number, courseCount: number }
   */
  calculateCredits(grades) {
    let totalCredits = 0;
    let passedCredits = 0;
    let courseCount = 0;

    for (const g of grades) {
      const credits = parseFloat(g.credits) || 0;
      totalCredits += credits;
      if (g.isPassed) {
        passedCredits += credits;
        courseCount++;
      }
    }

    return {
      totalCredits: Math.round(totalCredits * 100) / 100,
      passedCredits: Math.round(passedCredits * 100) / 100,
      courseCount,
    };
  }

  /**
   * 检查是否超过本学期学分上限
   * @param {number} currentSemesterCredits - 本学期已选学分
   * @param {number} newCourseCredits - 新课程学分
   * @param {number} maxCredits - 上限（默认 25）
   * @returns {Object} { exceeded: boolean, totalAfter: number, maxAllowed: number }
   */
  checkCreditLimit(currentSemesterCredits, newCourseCredits, maxCredits = 25) {
    const totalAfter = currentSemesterCredits + newCourseCredits;
    return {
      exceeded: totalAfter > maxCredits,
      totalAfter: Math.round(totalAfter * 100) / 100,
      maxAllowed: maxCredits,
      currentCredits: Math.round(currentSemesterCredits * 100) / 100,
      newCredits: Math.round(newCourseCredits * 100) / 100,
    };
  }

  // ==================== 计算分析（Calculators） ====================

  /**
   * 计算 GPA 趋势（按学期）
   * @param {Array} grades - 成绩列表
   * @returns {Array} [{semester, gpa, credits, courseCount}]
   */
  calculateGPATrend(grades) {
    const bySemester = {};
    for (const g of grades) {
      const sem = g.semester || '未知学期';
      if (!bySemester[sem]) {
        bySemester[sem] = { totalGradePoints: 0, totalCredits: 0, courses: [] };
      }
      if (g.gradeNumeric && g.isPassed !== '否') {
        const gpa = g.gpa || (g.gradeNumeric / 10 - 5); // 近似转换
        const cappedGpa = Math.max(0, Math.min(gpa, 4.0));
        bySemester[sem].totalGradePoints += cappedGpa * (g.credits || 0);
        bySemester[sem].totalCredits += g.credits || 0;
      }
      bySemester[sem].courses.push(g);
    }

    return Object.entries(bySemester)
      .map(([semester, data]) => ({
        semester,
        gpa: data.totalCredits > 0 ? Math.round((data.totalGradePoints / data.totalCredits) * 100) / 100 : 0,
        credits: Math.round(data.totalCredits * 100) / 100,
        courseCount: data.courses.length,
      }))
      .sort((a, b) => a.semester.localeCompare(b.semester));
  }

  /**
   * 学分分布分析
   * @param {Array} grades - 成绩列表
   * @returns {Object} { byNature: Object, byCategory: Object, total: number }
   */
  analyzeCreditDistribution(grades) {
    const byNature = {};
    const byCategory = {};

    for (const g of grades) {
      // 按课程性质
      const nature = g.courseNature || '其他';
      if (!byNature[nature]) byNature[nature] = { credits: 0, count: 0 };
      byNature[nature].credits += g.credits || 0;
      byNature[nature].count++;

      // 按课程类别
      const cat = g.courseCategory || '其他';
      if (!byCategory[cat]) byCategory[cat] = { credits: 0, count: 0 };
      byCategory[cat].credits += g.credits || 0;
      byCategory[cat].count++;
    }

    // 四舍五入
    for (const k of Object.keys(byNature)) {
      byNature[k].credits = Math.round(byNature[k].credits * 100) / 100;
    }
    for (const k of Object.keys(byCategory)) {
      byCategory[k].credits = Math.round(byCategory[k].credits * 100) / 100;
    }

    return { byNature, byCategory };
  }

  /**
   * 从周次位图中提取共同周次
   * @param {string} bitmapA - 位图字符串，如 "111111100000111111"
   * @param {string} bitmapB - 同上
   * @returns {number[]} 共同周次数组
   */
  _getCommonWeeks(bitmapA, bitmapB) {
    if (!bitmapA || !bitmapB) return [];

    const common = [];
    const maxLen = Math.max(bitmapA.length, bitmapB.length);
    for (let i = 0; i < maxLen; i++) {
      if (bitmapA[i] === '1' && bitmapB[i] === '1') {
        common.push(i + 1); // 周次从 1 开始
      }
    }
    return common;
  }

  /**
   * 在知识库中检索课程先修要求
   * @param {string} courseName - 课程名称
   * @returns {Promise<{success: boolean, prerequisites?: Array, description?: string}>}
   */
  async lookupCourseRequirements(courseName) {
    try {
      const result = await ragService.chat(
        `这门课的先修课程要求是什么？${courseName}`,
        [],
        { category: '教务相关' }
      );

      if (!result || !result.reply) {
        return { success: false, description: '知识库中未找到该课程的先修要求信息' };
      }

      // 尝试从回复中提取先修课名
      const prereqMatches = result.reply.match(/先修[课程]*[：:]\s*([^\n。]+)/);
      const prereqList = prereqMatches
        ? prereqMatches[1].split(/[、,，]/).map(s => s.trim()).filter(Boolean)
        : [];

      return {
        success: true,
        prerequisites: prereqList,
        description: result.reply,
        sources: result.sources,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = new DeterministicTools();
