"use strict";

/**
 * Agent 工具注册表（重构版）
 *
 * 使用 ToolRegistry 动态管理工具。
 * 保留原有 getToolSchemas / executeTool / getToolNames 导出接口以兼容 agent.service.js。
 */

const { ToolRegistry, TOOL_SOURCES } = require('./tool-registry.service');
const { RagService } = require('./rag.service');
const { aiService } = require('./ai.service');
const { redis: store } = require('./memory-store');
const { create } = require('mathjs');
const schoolApi = require('./school-api.service');

const ragService = new RagService(aiService);

// ============================================================
// 创建全局注册表并注册内置工具
// ============================================================

const toolRegistry = new ToolRegistry();

const builtinTools = [
  {
    name: 'search_knowledge_base',
    description: '从校园知识库中检索相关信息。当用户询问学校相关问题时使用此工具。支持按类别检索：学校概况、计算机学院、图书馆、教务相关。',
    category: '知识库',
    source: TOOL_SOURCES.BUILTIN,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '检索关键词或问题'
        },
        category: {
          type: 'string',
          enum: ['学校概况', '计算机学院', '图书馆', '教务相关', 'general'],
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
    name: 'query_grades',
    description: '查询学生的成绩信息。返回各科成绩、学分、绩点等。需要用户已绑定学校账号。',
    category: '教务',
    source: TOOL_SOURCES.SCHOOL,
    parameters: {
      type: 'object',
      properties: {
        semester: {
          type: 'string',
          description: '学年学期，如 "2025-2026-1"。不填则查询全部学期。'
        }
      },
      required: []
    },
    handler: async (args, context) => {
      if (!context?.userId) {
        return '查询成绩需要先登录系统。请在设置中绑定学校账号后再试。';
      }

      try {
        const info = await store.hgetall(`school:user:${context.userId}`);
        console.log(`[Tool:query_grades] userId=${context.userId}, redisKey=school:user:${context.userId}, found=${!!info?.studentId}`);
        if (!info || !info.studentId) {
          return '您还未绑定学校账号。请在设置页面绑定教务系统账号（学号和密码）后再查询成绩。';
        }

        const grades = await schoolApi.getGrades(
          context.userId,
          args.semester
        );

        if (!grades || grades.length === 0) {
          return '未查询到成绩信息。可能原因：1) 未选择正确的学期 2) 成绩尚未发布';
        }

        let result = `共 ${grades.length} 条成绩记录：\n\n`;

        const grouped = {};
        for (const g of grades) {
          const sem = g.semester || '未知学期';
          if (!grouped[sem]) grouped[sem] = [];
          grouped[sem].push(g);
        }

        for (const [sem, courses] of Object.entries(grouped)) {
          result += `📅 ${sem}\n`;
          result += '─'.repeat(50) + '\n';
          for (const c of courses) {
            const gradeStr = c.gradeNumeric !== null ? `${c.grade} (${c.gradeType})` : c.grade;
            result += `  ${c.courseName}\n`;
            result += `    成绩: ${gradeStr} | 学分: ${c.credits} | 性质: ${c.courseNature}\n`;
            if (c.examType) result += `    考试: ${c.examType} | 日期: ${c.examDate}\n`;
            result += '\n';
          }
        }

        return result;
      } catch (err) {
        return `查询成绩失败: ${err.message}`;
      }
    }
  },

  {
    name: 'query_course_schedule',
    description: '查询学生的课程表信息。返回一周的课程安排，包括课程名称、时间、地点、教师。需要用户已绑定学校账号。',
    category: '教务',
    source: TOOL_SOURCES.SCHOOL,
    parameters: {
      type: 'object',
      properties: {
        semester: {
          type: 'string',
          description: '学年学期，如 "2025-2026-2"。不填则查当前学期。'
        },
        week: {
          type: 'integer',
          description: '查询第几周（可选，默认返回全学期课表）'
        },
        day: {
          type: 'string',
          enum: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
          description: '查询星期几（可选，默认返回整周）'
        }
      },
      required: []
    },
    handler: async (args, context) => {
      if (!context?.userId) {
        return '查询课表需要先登录系统。请在设置中绑定学校账号后再试。';
      }

      try {
        const info = await store.hgetall(`school:user:${context.userId}`);
        console.log(`[Tool:query_course_schedule] userId=${context.userId}, redisKey=school:user:${context.userId}, found=${!!info?.studentId}`);
        if (!info || !info.studentId) {
          return '您还未绑定学校账号。请在设置页面绑定教务系统账号后再查询课表。';
        }

        const schedule = await schoolApi.getSchedule(
          context.userId,
          args.semester
        );

        if (!schedule || schedule.length === 0) {
          return '未查询到课表信息。';
        }

        const byDay = { '周一': [], '周二': [], '周三': [], '周四': [], '周五': [], '周六': [], '周日': [] };
        for (const c of schedule) {
          if (args.week && c.weekBitmap) {
            const weekChar = c.weekBitmap[args.week - 1];
            if (weekChar !== '1') continue;
          }
          if (byDay[c.weekDay]) {
            byDay[c.weekDay].push(c);
          }
        }

        if (args.day) {
          const dayCourses = byDay[args.day];
          if (!dayCourses || dayCourses.length === 0) {
            return `${args.day}没有课程安排`;
          }
          const lines = dayCourses.map(c =>
            `  ${c.startTime}-${c.endTime} | ${c.courseName} | ${c.classroom} | ${c.teacher}`
          );
          return `${args.day}课程表：\n${lines.join('\n')}`;
        }

        let result = '本周课程表：\n';
        for (const [day, courses] of Object.entries(byDay)) {
          if (courses.length === 0) continue;
          result += `\n${day}：\n`;
          courses.sort((a, b) => a.startPeriod - b.startPeriod);
          for (const c of courses) {
            result += `  ${c.startTime}-${c.endTime} | ${c.courseName} | ${c.classroom} | ${c.teacher}\n`;
          }
        }
        return result;
      } catch (err) {
        return `查询课表失败: ${err.message}`;
      }
    }
  },

  {
    name: 'query_exam_schedule',
    description: '查询考试安排信息，包括考试时间、地点、科目等。需要用户已绑定学校账号。',
    category: '教务',
    source: TOOL_SOURCES.SCHOOL,
    parameters: {
      type: 'object',
      properties: {
        semester: {
          type: 'string',
          description: '学年学期，如 "2025-2026-2"。不填则查当前学期。'
        },
        course: {
          type: 'string',
          description: '课程名称（可选，模糊匹配）'
        }
      },
      required: []
    },
    handler: async (args, context) => {
      if (!context?.userId) {
        return '查询考试需要先登录系统。请在设置中绑定学校账号后再试。';
      }

      try {
        const info = await store.hgetall(`school:user:${context.userId}`);
        console.log(`[Tool:query_exam_schedule] userId=${context.userId}, redisKey=school:user:${context.userId}, found=${!!info?.studentId}`);
        if (!info || !info.studentId) {
          return '您还未绑定学校账号。请在设置页面绑定教务系统账号后再查询考试。';
        }

        const exams = await schoolApi.getExams(
          context.userId,
          args.semester
        );

        if (!exams || exams.length === 0) {
          return '当前学期暂无考试安排。';
        }

        let filtered = exams;
        if (args.course) {
          filtered = exams.filter(e =>
            e.courseName.includes(args.course)
          );
          if (filtered.length === 0) {
            return `未找到"${args.course}"相关的考试安排`;
          }
        }

        const lines = filtered.map(e =>
          `  📝 ${e.courseName}\n    时间: ${e.examTime}\n    地点: ${e.location}\n    类型: ${e.examType}${e.invigilator ? '\n    监考: ' + e.invigilator : ''}${e.seatNumber ? '\n    座位号: ' + e.seatNumber : ''}`
        );
        return `考试安排（共 ${filtered.length} 场）：\n\n${lines.join('\n\n')}`;
      } catch (err) {
        return `查询考试失败: ${err.message}`;
      }
    }
  },

  {
    name: 'campus_info',
    description: '查询武汉理工大学校园基本信息，包括校区地址、联系电话、校车时刻、校历等。',
    category: '校园',
    source: TOOL_SOURCES.BUILTIN,
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: ['校区地址', '联系电话', '校车时刻', '校历', '校训', '概况'],
          description: '查询主题'
        }
      },
      required: ['topic']
    },
    handler: async (args) => {
      const info = {
        '校区地址': `武汉理工大学校区地址：
  马房山校区：武汉市洪山区珞狮路122号
  余家头校区：武汉市武昌区和平大道1178号
  南湖校区：武汉市雄楚大道168号`,
        '联系电话': `常用联系电话：
  招生办：027-87859017
  教务处：027-87651321
  图书馆：027-87651543
  信息中心：027-87651728
  后勤集团：027-87651890`,
        '校车时刻': `马房山 ↔ 余家头 校车时刻：
  马房山发车：7:30, 8:30, 10:00, 12:00, 14:00, 16:00, 17:30
  余家头发车：7:30, 8:30, 10:00, 12:00, 14:00, 16:00, 17:30
  车程约 30 分钟，免费乘坐`,
        '校历': `2024-2025 学年校历：
  第一学期：2024年9月2日 - 2025年1月17日
  寒假：2025年1月18日 - 2月21日
  第二学期：2025年2月24日 - 2025年7月11日
  暑假：2025年7月12日 - 8月29日`,
        '校训': '武汉理工大学校训：厚德博学、追求卓越',
        '概况': `武汉理工大学简介：
  教育部直属全国重点大学，国家"211工程"和"双一流"建设高校。
  由原武汉工业大学、武汉交通科技大学、武汉汽车工业大学于2000年合并组建。
  现有马房山、余家头、南湖三个校区，占地4000余亩。
  在校学生5万余人，教职工5000余人。
  优势学科：材料科学与工程、船舶与海洋工程、机械工程等。`
      };

      return info[args.topic] || `可用主题：${Object.keys(info).join('、')}`;
    }
  },

  {
    name: 'calculate',
    description: '执行数学计算。支持加减乘除、乘方、开方、三角函数等。当用户需要计算时使用。',
    category: '工具',
    source: TOOL_SOURCES.BUILTIN,
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

        // 使用 mathjs 安全求值，避免 new Function() 注入风险
        const math = create({ all: true });
        const result = math.evaluate(expr);

        if (typeof result !== 'number' || !isFinite(result)) {
          return `计算结果无效: ${result}`;
        }

        return `${args.expression} = ${result}`;
      } catch (err) {
        return `计算失败: ${err.message}`;
      }
    }
  }
];

// ============================================================
// 选课可行性工具（确定性工具层）
// 这些工具将判断逻辑交给代码执行，LLM 只负责读取结果并决策
// ============================================================

const deterministicTools = require('./deterministic-tools');

const courseSelectionTools = [
  {
    name: 'lookup_requirements',
    description: '查询课程的先修要求和其他选课限制。从校园知识库中检索课程的选课条件，包括先修课程、学分要求、年级限制等。',
    category: '教务',
    source: TOOL_SOURCES.SCHOOL,
    parameters: {
      type: 'object',
      properties: {
        courseName: {
          type: 'string',
          description: '要查询的课程名称，如 "数据结构"、"操作系统"'
        }
      },
      required: ['courseName']
    },
    handler: async (args) => {
      const result = await deterministicTools.lookupCourseRequirements(args.courseName);
      if (!result.success) {
        return `查询课程「${args.courseName}」的要求失败：${result.error || result.description}`;
      }
      let reply = `课程「${args.courseName}」的选课要求：\n`;
      if (result.prerequisites && result.prerequisites.length > 0) {
        reply += `先修课程：${result.prerequisites.join('、')}\n`;
      } else {
        reply += `先修课程：无明确要求\n`;
      }
      if (result.description) {
        reply += `\n详细信息：${result.description}`;
      }
      return reply;
    }
  },
  {
    name: 'check_prerequisites',
    description: '检查学生是否满足课程的先修课程要求。这是确定性判断，由代码完成。返回每门先修课是否满足的结果。',
    category: '教务',
    source: TOOL_SOURCES.SCHOOL,
    parameters: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: '用户 ID'
        },
        courseName: {
          type: 'string',
          description: '课程名称'
        },
        prerequisites: {
          type: 'array',
          items: { type: 'string' },
          description: '先修课程名称列表'
        }
      },
      required: ['userId', 'prerequisites']
    },
    handler: async (args, context) => {
      const userId = args.userId || context?.userId;
      if (!userId) {
        return '检查先修课需要用户登录。请在设置中绑定学校账号。';
      }

      const gradesResult = await deterministicTools.getStudentGrades(userId);
      if (!gradesResult.success) {
        return `获取成绩失败：${gradesResult.error}`;
      }

      const prereqs = (args.prerequisites || []).map(name => ({ courseName: name }));
      const check = deterministicTools.checkPrerequisites(gradesResult.data, prereqs);

      if (check.passed) {
        return `✅ 先修课程检查通过！您已满足「${args.courseName || '该课程'}」的全部 ${prereqs.length} 项先修要求。`;
      }

      const failed = check.details.filter(d => !d.passed);
      let reply = `❌ 先修课程检查不通过。以下 ${failed.length} 项不满足：\n`;
      for (const f of failed) {
        reply += `  - ${f.course}：${f.reason}（需要 ${f.minGrade}，实际 ${f.studentGrade || '未修'}）\n`;
      }
      reply += '\n建议：请先完成上述先修课程的学习并通过考试后再选课。';
      return reply;
    }
  },
  {
    name: 'check_time_conflict',
    description: '检查新课程与已有课表是否存在时间冲突。这是确定性判断，由代码完成。比较周次位图和节次范围。',
    category: '教务',
    source: TOOL_SOURCES.SCHOOL,
    parameters: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: '用户 ID'
        },
        newCourse: {
          type: 'object',
          description: '新课的时间信息：{weekDay, startPeriod, endPeriod, weekBitmap, courseName}'
        }
      },
      required: ['userId', 'newCourse']
    },
    handler: async (args, context) => {
      const userId = args.userId || context?.userId;
      if (!userId) {
        return '检查时间冲突需要用户登录。请在设置中绑定学校账号。';
      }

      const scheduleResult = await deterministicTools.getStudentSchedule(userId);
      if (!scheduleResult.success) {
        return `获取课表失败：${scheduleResult.error}`;
      }

      const conflictCheck = deterministicTools.checkScheduleConflicts(args.newCourse, scheduleResult.data);

      if (!conflictCheck.hasConflict) {
        return `✅ 时间冲突检查通过！「${args.newCourse.courseName || '新课'}」与您的课表没有时间冲突。`;
      }

      const c = conflictCheck.conflicts[0];
      let reply = `❌ 发现时间冲突！\n\n`;
      reply += `您的课程「${c.existingCourseName}」（${c.day} 第 ${c.periodA} 节）\n`;
      reply += `与「${c.courseB || '新课'}」（${c.day} 第 ${c.periodB} 节）时间重叠\n`;
      reply += `重叠周次：第 ${c.weeks.slice(0, 5).join(', ')}${c.weeks.length > 5 ? ' 等' : ''} 周\n`;
      reply += '\n建议：请调整选课计划，选择时间不冲突的其他课程。';
      return reply;
    }
  },
  {
    name: 'check_credit_limit',
    description: '检查本学期选课学分是否超过上限。这是确定性判断，由代码完成。',
    category: '教务',
    source: TOOL_SOURCES.SCHOOL,
    parameters: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: '用户 ID'
        },
        newCourseCredits: {
          type: 'number',
          description: '新课程的学分数'
        },
        maxCredits: {
          type: 'number',
          description: '学分上限（可选，默认25）'
        }
      },
      required: ['userId', 'newCourseCredits']
    },
    handler: async (args, context) => {
      const userId = args.userId || context?.userId;
      if (!userId) {
        return '检查学分需要用户登录。请在设置中绑定学校账号。';
      }

      const gradesResult = await deterministicTools.getStudentGrades(userId);
      if (!gradesResult.success) {
        return `获取成绩失败：${gradesResult.error}`;
      }

      const creditInfo = deterministicTools.calculateCredits(gradesResult.data);
      const check = deterministicTools.checkCreditLimit(
        creditInfo.passedCredits,
        args.newCourseCredits,
        args.maxCredits || 25
      );

      if (!check.exceeded) {
        return `✅ 学分检查通过！选课后总学分为 ${check.totalAfter}（上限 ${check.maxAllowed}），未超限。`;
      }

      return `❌ 学分超限！当前已获 ${check.currentCredits} 学分，加上本课程 ${check.newCredits} 学分后共 ${check.totalAfter} 学分，超过上限 ${check.maxAllowed} 学分。建议下学期再选或调整课程。`;
    }
  },
];

// 注册选课工具
for (const tool of courseSelectionTools) {
  toolRegistry.register(tool);
}

// 注册所有内置工具
for (const tool of builtinTools) {
  toolRegistry.register(tool);
}

// ============================================================
// 兼容导出（保持原有接口）
// ============================================================

function getToolSchemas() {
  return toolRegistry.getToolSchemas();
}

async function executeTool(name, args, context = {}) {
  return toolRegistry.executeTool(name, args, context);
}

function getToolNames() {
  return toolRegistry.getToolNames();
}

module.exports = {
  getToolSchemas,
  executeTool,
  getToolNames,
  toolRegistry,
  TOOL_SOURCES,
};
