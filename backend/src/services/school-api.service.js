/**
 * 学校教务系统 API 服务
 * 基于已抓包确认的金智教务系统接口
 */

const axios = require('axios');
const https = require('https');
const config = require('../config');
const sessionService = require('./school-session.service');
const { redis: store } = require('./memory-store');
const { metrics } = require('./metrics.service');

// 仅对教务系统域名禁用 TLS 验证（校内系统常见自签名证书）
const schoolAgent = new https.Agent({ rejectUnauthorized: false });
const schoolAxios = axios.create({ httpsAgent: schoolAgent });

class SchoolApiService {
  constructor() {
    this.jwHost = config.school.jwHost;
    this.cleanStats = {
      htmlEntities: 0,
      invisibleChars: 0,
      whitespaceFix: 0,
      nullValues: 0,
      totalFields: 0
    };
  }

  // ==================== 凭据管理 ====================

  /**
   * 从 Redis 获取用户的学号和密码（解密）
   * 替代外部透传密码的做法
   */
  async _getUserCredentials(userId) {
    const info = await store.hgetall(`school:user:${userId}`);
    if (!info || !info.studentId || !info.encryptedPassword) {
      throw createSchoolError(
        'SCHOOL_ACCOUNT_NOT_BOUND',
        '请先绑定学校账号'
      );
    }

    const encrypted = JSON.parse(info.encryptedPassword);
    const password = sessionService.decrypt(encrypted);

    return { studentId: info.studentId, password };
  }

  // ==================== 数据清洗工具 ====================

  /**
   * 清洗教务系统返回的原始字符串
   *
   * 处理的问题：
   * 1. HTML 实体编码（&nbsp;、&lt; 等）
   * 2. 多余空白（换行、制表符、连续空格）
   * 3. 不可见控制字符（U+200B 零宽空格等）
   * 4. 首尾空白
   *
   * @param {string} value - 原始值
   * @returns {string} 清洗后的字符串，空值返回空字符串
   */
  _cleanString(value) {
    if (value === null || value === undefined) {
      this.cleanStats.nullValues++;
      this.cleanStats.totalFields++;
      return '';
    }
    const str = String(value);
    this.cleanStats.totalFields++;

    const matches = { html: 0, invisible: 0, ws: 0 };

    const cleaned = str
      // HTML 实体解码（常见于教务系统响应）
      .replace(/&nbsp;/g, () => { matches.html++; return ' '; })
      .replace(/&lt;/g, () => { matches.html++; return '<'; })
      .replace(/&gt;/g, () => { matches.html++; return '>'; })
      .replace(/&amp;/g, () => { matches.html++; return '&'; })
      .replace(/&quot;/g, () => { matches.html++; return '"'; })
      .replace(/&#39;/g, () => { matches.html++; return "'"; })
      // 零宽字符和不可见控制字符
      .replace(/[^\x20-\x7E一-鿿　-〿＀-￯]/g, (m) => {
        // 只统计真正不可见的控制字符（排除 CJK 扩展区的可见字符）
        if (m.charCodeAt(0) < 0x20 || (m.charCodeAt(0) >= 0x7F && m.charCodeAt(0) <= 0x9F)) {
          matches.invisible++;
        }
        return '';
      })
      // 制表符和换行符替换为空格
      .replace(/[\t\n\r]+/g, () => { matches.ws++; return ' '; })
      // 合并连续空格为单个空格
      .replace(/\s{2,}/g, ' ')
      // 去除首尾空格
      .trim();

    this.cleanStats.htmlEntities += matches.html;
    this.cleanStats.invisibleChars += matches.invisible;
    this.cleanStats.whitespaceFix += matches.ws;

    return cleaned;
  }

  /**
   * 清洗并去重数组（按指定字段去重，保留第一条）
   *
   * @param {Array} rows - 原始数据行
   * @param {string} keyField - 用于去重的唯一字段
   * @returns {Array} 去重后的数组
   */
  _deduplicate(rows, keyField) {
    if (!rows || rows.length <= 1) return rows || [];
    const seen = new Set();
    return rows.filter(row => {
      const key = row[keyField];
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * 获取数据清洗统计并同步到全局 metrics
   */
  getCleanStats() {
    const stats = { ...this.cleanStats };
    metrics.recordCleaning(stats);
    return stats;
  }

  /**
   * 重置清洗统计计数器
   */
  resetCleanStats() {
    this.cleanStats = {
      htmlEntities: 0,
      invisibleChars: 0,
      whitespaceFix: 0,
      nullValues: 0,
      totalFields: 0
    };
  }

  // ==================== 成绩查询 ====================

  /**
   * 查询学生成绩
   * @param {string} userId - 系统用户 ID（从 redis 获取学号和密码）
   * @param {string} semester - 学年学期，如 "2025-2026-1"，空则查全部
   */
  async getGrades(userId, semester) {
    const { studentId, password } = await this._getUserCredentials(userId);
    const cookies = await sessionService.getSession(userId, studentId, password);

    // 构造查询条件
    const querySetting = [
      {
        name: 'SFYX',
        caption: '是否有效',
        linkOpt: 'AND',
        builderList: 'cbl_m_List',
        builder: 'm_value_equal',
        value: '1',
        value_display: '是',
      },
      {
        name: 'SHOWMAXCJ',
        caption: '显示最高成绩',
        linkOpt: 'AND',
        builderList: 'cbl_m_List',
        builder: 'm_value_equal',
        value: '0',
        value_display: '否',
      },
    ];

    // 如果指定了学期
    if (semester) {
      querySetting.unshift({
        name: 'XNXQDM',
        value: semester,
        linkOpt: 'and',
        builder: 'm_value_equal',
      });
    }

    const body = new URLSearchParams({
      querySetting: JSON.stringify(querySetting),
      '*order': '-XNXQDM,-KCH,-KXH',
      pageSize: '200',
      pageNumber: '1',
    }).toString();

    try {
      const res = await schoolAxios.post(
        `${this.jwHost}/jwapp/sys/cjcx/modules/cjcx/xscjcx.do`,
        body,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            Cookie: cookies,
          },
          timeout: 15000,
        }
      );

      if (res.data?.code !== '0') {
        const errMsg = res.data?.msg || '查询成绩失败';
        // 教务系统返回非 0 状态码通常是 session 失效
        sessionService.invalidateSession(userId);
        throw new Error(errMsg);
      }

      const rows = res.data?.datas?.xscjcx?.rows || [];
      return this._formatGrades(rows);
    } catch (err) {
      // 如果是 403 或 session 失效，清除缓存重试一次
      if (err.response?.status === 403 || err.response?.status === 302) {
        sessionService.invalidateSession(userId);
        throw new Error('教务系统登录已过期，请重新绑定学校账号');
      }
      throw err;
    }
  }

  // ==================== 课表查询 ====================

  /**
   * 查询学生课表
   * @param {string} userId
   * @param {string} semester - 学年学期，如 "2025-2026-2"
   */
  async getSchedule(userId, semester) {
    const { studentId, password } = await this._getUserCredentials(userId);
    const cookies = await sessionService.getSession(userId, studentId, password);

    // 如果没指定学期，先获取当前学期
    if (!semester) {
      semester = await this._getCurrentSemester(cookies);
    }

    try {
      const res = await schoolAxios.post(
        `${this.jwHost}/jwapp/sys/kcbcxby/modules/xskcb/cxxskcb.do`,
        new URLSearchParams({
          XNXQDM: semester,
          XH: studentId,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            Cookie: cookies,
          },
          timeout: 15000,
        }
      );

      if (res.data?.code !== '0') {
        const errMsg = res.data?.msg || '查询课表失败';
        sessionService.invalidateSession(userId);
        throw new Error(errMsg);
      }

      const rows = res.data?.datas?.cxxskcb?.rows || [];
      return this._formatSchedule(rows);
    } catch (err) {
      if (err.response?.status === 403 || err.response?.status === 302) {
        sessionService.invalidateSession(userId);
        throw new Error('教务系统登录已过期，请重新绑定学校账号');
      }
      throw err;
    }
  }

  // ==================== 考试查询 ====================

  /**
   * 查询考试安排
   * @param {string} userId
   * @param {string} semester - 学年学期
   */
  async getExams(userId, semester) {
    const { studentId, password } = await this._getUserCredentials(userId);
    const cookies = await sessionService.getSession(userId, studentId, password);

    if (!semester) {
      semester = await this._getCurrentSemester(cookies);
    }

    try {
      const res = await schoolAxios.post(
        `${this.jwHost}/jwapp/sys/wdkwapp/api/wdks/queryMyExamArrangeMent.do`,
        new URLSearchParams({
          XNXQDM: semester,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            Cookie: cookies,
          },
          timeout: 15000,
        }
      );

      if (res.data?.code !== '0') {
        const errMsg = res.data?.msg || '查询考试失败';
        sessionService.invalidateSession(userId);
        throw new Error(errMsg);
      }

      // 注意：考试数据在 arranged 数组中，不是 rows
      const data = res.data?.datas?.queryMyExamArrangeMent || {};
      const arranged = data.arranged || [];
      return this._formatExams(arranged);
    } catch (err) {
      if (err.response?.status === 403 || err.response?.status === 302) {
        sessionService.invalidateSession(userId);
        throw new Error('教务系统登录已过期，请重新绑定学校账号');
      }
      throw err;
    }
  }

  // ==================== 学业监测（未评教成绩回填） ====================

  /**
   * 递归遍历树形结构，提取所有课程行
   * 教务系统的学业监测数据是嵌套树结构，需要通过多级 child 字段递归提取
   */
  _extractMonitorCourseRows(node, depth = 0) {
    if (!node || typeof node !== 'object') return [];
    if (depth > 20) return []; // 防止无限递归

    const rows = [];

    // 判断当前节点是否是课程行（同时有课程代码/名称 和 成绩/学分字段）
    const hasCourseCode = !!(node.KCH || node.KCM || node.kcm || node.courseName);
    const hasScore = !!(node.ZCJ || node.CJ || node.XF || node.KCXF || node.score);
    if (hasCourseCode && hasScore) {
      rows.push(node);
    }

    // 递归搜索所有可能的子节点字段
    const childKeys = [
      'children', 'CHILDREN', 'childList', 'childNodes',
      'nodes', 'items', 'data', 'rows', 'list',
      'checkCourseVOS', 'courseList', 'courses', 'courseVOS',
    ];
    for (const key of childKeys) {
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) {
          rows.push(...this._extractMonitorCourseRows(c, depth + 1));
        }
      } else if (child && typeof child === 'object') {
        rows.push(...this._extractMonitorCourseRows(child, depth + 1));
      }
    }

    return rows;
  }

  /**
   * 标准化学业监测中的课程行
   */
  _normalizeMonitorCourse(row) {
    return {
      courseName: this._cleanString(row.KCM || row.KCMC || row.kcm || row.courseName || ''),
      courseId: this._cleanString(row.KCH || row.kch || row.courseId || row.KCBH || row.kcbh || ''),
      credit: parseFloat(row.XF || row.KCXF || row.xf || row.credit) || 0,
      score: row.ZCJ || row.CJ || row.cj || row.score || '',
      scoreText: this._cleanString(row.XSZCJMC || row.DJCJ_DISPLAY || row.cjText || ''),
      semester: row.XNXQDM || row.xnxqdm || row.semester || '',
      gpa: row.JD ? parseFloat(row.JD) : (row.jd ? parseFloat(row.jd) : null),
      isPassed: this._cleanString(row.SFYX || row.sfyx || ''),
    };
  }

  /**
   * 获取学业监测数据，用于回填未评教课程的隐藏成绩
   *
   * 教务系统中，未完成评教的课程在成绩查询时显示"未评教"，
   * 但学业监测接口已经包含了这些课程的真实成绩。
   * 此方法调用学业监测 API，提取所有课程成绩，并与成绩数据比对，
   * 找出被隐藏的真实成绩。
   *
   * @param {string} userId - 系统用户 ID
   * @returns {Promise<Array>} 未评教课程的回填成绩列表
   */
  async getMonitorScores(userId) {
    const { studentId, password } = await this._getUserCredentials(userId);
    const cookies = await sessionService.getSession(userId, studentId, password);

    try {
      // 1. 并行获取学业监测数据 + 成绩数据
      const [monitorRes, grades] = await Promise.all([
        // 学业监测 API
        schoolAxios.post(
          `${this.jwHost}/jwapp/sys/xyjscx/modules/xyjscx/cxxyjs.do`,
          new URLSearchParams({
            querySetting: JSON.stringify([]),
            '*order': '+XH',
            pageSize: '1000',
            pageNumber: '1',
          }).toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest',
              Cookie: cookies,
            },
            timeout: 20000,
          }
        ),
        // 同时获取成绩数据
        this.getGrades(userId).catch(() => []),
      ]);

      // 2. 解析学业监测数据
      if (monitorRes.data?.code !== '0') {
        throw new Error(monitorRes.data?.msg || '获取学业监测数据失败');
      }

      const rootNodes = monitorRes.data?.datas?.cxxyjs?.rows || [];
      const rawCourses = [];
      for (const root of rootNodes) {
        rawCourses.push(...this._extractMonitorCourseRows(root));
      }

      // 3. 标准化数据
      const monitorCourses = rawCourses.map(r => this._normalizeMonitorCourse(r));

      // 4. 去重（同一课程只保留第一条）
      const seen = new Set();
      const uniqueMonitorCourses = monitorCourses.filter(c => {
        const key = `${c.semester}|${c.courseId}`;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // 5. 从成绩数据中找出"未评教"课程
      const ungradedGrades = grades.filter(g => {
        const gradeStr = String(g.grade || '').trim();
        return gradeStr === '未评教' || gradeStr === 'N/A' || gradeStr === '-';
      });

      if (ungradedGrades.length === 0) {
        return { ungraded: [], allMonitorCourses: uniqueMonitorCourses };
      }

      // 6. 匹配回填：用学业监测数据中的真实成绩覆盖"未评教"
      const results = [];
      for (const grade of ungradedGrades) {
        // 匹配优先级：courseId + semester > courseName + semester > courseId > courseName
        const match =
          uniqueMonitorCourses.find(r =>
            r.courseId && r.semester &&
            r.courseId === grade.courseCode &&
            r.semester === grade.semester
          )
          || uniqueMonitorCourses.find(r =>
            r.courseName && r.semester &&
            r.courseName === grade.courseName &&
            r.semester === grade.semester
          )
          || uniqueMonitorCourses.find(r =>
            r.courseId && r.courseId === grade.courseCode
          )
          || uniqueMonitorCourses.find(r =>
            r.courseName && r.courseName === grade.courseName
          );

        if (match && match.score && match.score !== '未评教') {
          results.push({
            courseName: grade.courseName,
            courseCode: grade.courseCode,
            semester: grade.semester,
            credits: grade.credits,
            hiddenGrade: grade.grade,
            realScore: match.score,
            realScoreText: match.scoreText,
            realGpa: match.gpa,
            matchedBy: match.courseId === grade.courseCode && match.semester === grade.semester
              ? 'courseId+semester'
              : match.courseName === grade.courseName && match.semester === grade.semester
                ? 'courseName+semester'
                : '模糊匹配',
          });
        }
      }

      return {
        ungraded: results,
        totalUngraded: ungradedGrades.length,
        matchedCount: results.length,
        allMonitorCourses: uniqueMonitorCourses,
      };
    } catch (err) {
      if (err.response?.status === 403 || err.response?.status === 302) {
        sessionService.invalidateSession(userId);
        throw new Error('教务系统登录已过期，请重新绑定学校账号');
      }
      throw err;
    }
  }

  // ==================== 内部方法 ====================

  /**
   * 获取当前学年学期
   */
  async _getCurrentSemester(cookies) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await schoolAxios.post(
        `${this.jwHost}/jwapp/sys/kcbcxby/modules/bjkcb/dqzc.do`,
        new URLSearchParams({
          XN: `${new Date().getFullYear() - 1}-${new Date().getFullYear()}`,
          XQ: new Date().getMonth() >= 8 ? '1' : '2',
          RQ: today,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: cookies,
          },
          timeout: 10000,
        }
      );

      const row = res.data?.datas?.dqzc?.rows?.[0];
      if (row?.XN && row?.XQ) {
        return `${row.XN}-${row.XQ}`;
      }
    } catch (err) {
      console.warn('[SchoolApi] 获取当前学期失败，使用兜底计算:', err.message);
    }

    // 兜底：根据当前月份估算
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    if (month >= 9) return `${year}-${year + 1}-1`;
    if (month >= 2) return `${year - 1}-${year}-2`;
    return `${year - 1}-${year}-1`;
  }

  // ==================== 数据格式化 ====================

  /**
   * 获取可用的学年学期列表
   */
  async getSemesters(userId) {
    const { studentId, password } = await this._getUserCredentials(userId);
    const cookies = await sessionService.getSession(userId, studentId, password);

    try {
      const res = await schoolAxios.post(
        `${this.jwHost}/jwapp/sys/cjcx/modules/cjcx/cxdqxnxqhsygxnxq.do`,
        '',
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: cookies,
          },
          timeout: 15000,
        }
      );

      const rows = res.data?.datas?.cxdqxnxqhsygxnxq?.rows || [];
      return rows.map((r) => r.XNXQDM).filter(Boolean);
    } catch (err) {
      if (err.response?.status === 403) {
        sessionService.invalidateSession(userId);
      }
      throw err;
    }
  }

  // ==================== 数据格式化 ====================

  /**
   * 将原始成绩数据格式化为易读的结构
   */
  /**
   * 格式化课表数据
   */
  _formatSchedule(rows) {
    const weekDays = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const seen = new Set();

    return rows
      .map((r) => ({
        courseName: this._cleanString(r.KCM),
        courseCode: this._cleanString(r.KCH),
        teacher: this._cleanString(r.SKJS),
        classroom: this._cleanString(r.JASMC),
        building: this._cleanString(r.JXLDM_DISPLAY),
        campus: this._cleanString(r.XXXQDM_DISPLAY),

        // 时间信息
        weekDay: weekDays[r.SKXQ] || '',
        weekDayNum: r.SKXQ || 0,
        startPeriod: r.KSJC || 0,
        endPeriod: r.JSJC || 0,
        startTime: this._cleanString(r.KSSJ),
        endTime: this._cleanString(r.JSSJ),

        // 周次信息（位图格式，每位代表一周）
        weekBitmap: this._cleanString(r.SKZC),
        weekRange: this._cleanString(r.ZCMC),

        // 课程信息
        credits: parseFloat(r.XF) || 0,
        hours: parseInt(r.XS) || 0,
        courseNature: this._cleanString(r.KCXZDM_DISPLAY),
        department: this._cleanString(r.KKDWDM_DISPLAY),

        // 其他
        semester: this._cleanString(r.XNXQDM_DISPLAY || r.XNXQDM),
        classNumber: this._cleanString(r.KXH),
        className: this._cleanString(r.BJDM_DISPLAY),
        studentCount: r.XKZRS || 0,
      }))
      .filter((item) => {
        // 按 课程名+星期+开始时间+教室 去重
        const key = `${item.courseName}|${item.weekDay}|${item.startTime}|${item.classroom}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  /**
   * 格式化考试数据
   */
  _formatExams(arranged) {
    return arranged.map((r) => ({
      courseName: this._cleanString(r.KCM),
      courseCode: this._cleanString(r.KCH),

      // 考试信息
      examTime: this._cleanString(r.KSSJMS),
      examDate: this._cleanString(r.KSRQ),
      startTime: this._cleanString(r.KSSJ),
      endTime: this._cleanString(r.JSSJ),
      location: this._cleanString(r.JASMC),
      examType: this._cleanString(r.KSLXDM_DISPLAY),

      // 监考信息
      invigilator: this._cleanString(r.SKJS),
      seatNumber: this._cleanString(r.ZWH),

      // 其他
      semester: this._cleanString(r.XNXQDM),
      week: r.ZC || 0,
      className: this._cleanString(r.BJDM_DISPLAY),
      department: this._cleanString(r.KKDWDM_DISPLAY),
    }));
  }

  _formatGrades(rows) {
    // 先去重（防止分页抓取导致的数据重复）
    const uniqueRows = this._deduplicate(rows, 'KCH');

    return uniqueRows.map((r) => ({
      // 课程信息
      courseName: this._cleanString(r.XSKCM || r.KCM),
      courseCode: this._cleanString(r.XSKCH || r.KCH),
      courseNature: this._cleanString(r.KCXZDM_DISPLAY),
      courseCategory: this._cleanString(r.FAKCXZDM_DISPLAY),
      credits: parseFloat(r.XF) || 0,
      hours: parseInt(r.XS) || 0,

      // 成绩信息
      grade: this._cleanString(r.XSZCJMC || r.ZCJ) || 'N/A',
      gradeNumeric: parseFloat(r.ZCJ) || null,
      gpa: r.JD ? parseFloat(r.JD) : null,
      firstPassGrade: this._cleanString(r.SCTGCJMC),
      gradeType: this._cleanString(r.XSDJCJLXDM_DISPLAY),

      // 考试信息
      examType: this._cleanString(r.KSLXDM_DISPLAY),
      examDate: this._cleanString(r.KSSJ),

      // 学期信息
      semester: this._cleanString(r.XNXQDM_DISPLAY || r.XNXQDM),
      classNumber: this._cleanString(r.KXH),

      // 其他
      isMainMajor: this._cleanString(r.SFZX_DISPLAY),
      studyMode: this._cleanString(r.XDFSDM_DISPLAY),
      department: this._cleanString(r.KKDWDM_DISPLAY),
      isPassed: this._cleanString(r.SFYX_DISPLAY),
      isRetake: this._cleanString(r.SFFANKC_DISPLAY),
    }));
  }
}

module.exports = new SchoolApiService();
