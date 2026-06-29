const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, generateToken } = require('../middleware/auth.middleware');
const schoolApi = require('../services/school-api.service');
const sessionService = require('../services/school-session.service');
const { redis: store } = require('../services/memory-store');

const router = Router();

// 登录接口频率限制：每 IP 每分钟最多 10 次，防止暴力破解
const loginLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: { success: false, code: 'RATE_LIMIT', message: '登录尝试过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

const formatSchoolError = (err, fallbackMessage = '操作失败，请稍后重试') => {
  switch (err?.code) {
    case 'INVALID_CREDENTIALS':
      return {
        status: 401,
        code: 'INVALID_CREDENTIALS',
        message: '学号或密码错误，请重新输入',
      };
    case 'NETWORK_ERROR':
      return {
        status: 503,
        code: 'NETWORK_ERROR',
        message: '网络连接失败，暂时无法访问教务系统',
      };
    case 'SERVICE_UNAVAILABLE':
      return {
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: err.message || '教务系统暂时不可用，请稍后重试',
      };
    default:
      return {
        status: 500,
        code: 'UNKNOWN_ERROR',
        message: fallbackMessage,
      };
  }
};

/**
 * POST /api/school/login
 * 用教务系统账号直接登录
 * Body: { studentId, password }
 * 无需 JWT，公开接口
 */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { studentId, password } = req.body;

    if (!studentId || !password) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_CREDENTIALS',
        message: '请输入学号和密码',
      });
    }

    // 生成 userId（基于学号）
    const userId = `school_${studentId}`;

    // 清除旧 Cookie 缓存，确保每次都通过 Puppeteer 重新登录获取新 Cookie
    sessionService.invalidateSession(userId);

    // 尝试 CAS 登录验证（加 60 秒超时，防止 Puppeteer 卡死）
    console.log(`[SchoolLogin] 开始 CAS 登录: studentId=${studentId}`);
    try {
      await Promise.race([
        sessionService.login(studentId, password, userId),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('登录超时(60s)')), 60000)
        ),
      ]);
    } catch (err) {
      console.error('[SchoolLogin] CAS 登录失败:', err.message);
      if (err.message && err.message.includes('登录超时')) {
        return res.status(504).json({
          success: false,
          code: 'NETWORK_ERROR',
          message: '登录超时，教务系统响应过慢，请稍后重试',
        });
      }
      const schoolError = formatSchoolError(err, '登录失败，请稍后重试');
      return res.status(schoolError.status).json({
        success: false,
        code: schoolError.code,
        message: schoolError.message,
      });
    }

    // 登录成功，生成 JWT token 并设置 httpOnly cookie
    console.log(`[SchoolLogin] CAS 登录成功，设置 auth cookie`);
    const token = generateToken({ userId, username: studentId });

    // 设置 httpOnly cookie（前端无法读取，防止 XSS 窃取）
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    // 自动绑定学校账号（加密存储密码）
    try {
      const encrypted = sessionService.encrypt(password);
      await store.hset(`school:user:${userId}`, {
        studentId,
        encryptedPassword: JSON.stringify(encrypted),
        boundAt: new Date().toISOString(),
      });
    } catch (storeErr) {
      console.warn('[SchoolLogin] 保存绑定信息失败:', storeErr.message);
    }

    // 注意：不返回 token，仅返回用户信息（token 存储在 httpOnly cookie 中）
    res.json({
      success: true,
      message: '登录成功',
      data: {
        user: {
          id: userId,
          name: studentId,
          studentId,
        },
      },
    });
  } catch (err) {
    console.error('[SchoolLogin] unexpected error:', err);
    const schoolError = formatSchoolError(err, '登录失败，请稍后重试');
    res.status(schoolError.status).json({
      success: false,
      code: schoolError.code,
      message: schoolError.message,
    });
  }
});

// 以下接口需要登录
router.use(requireAuth);

/**
 * POST /api/school/bind
 * 绑定学校账号（学号 + 教务密码）
 * Body: { studentId, password }
 */
router.post('/bind', async (req, res) => {
  try {
    const { studentId, password } = req.body;
    const userId = req.userId;

    if (!studentId || !password) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_CREDENTIALS',
        message: '请提供学号和密码',
      });
    }

    // 清除旧 Cookie 缓存，确保通过 Puppeteer 重新登录获取新 Cookie
    sessionService.invalidateSession(userId);

    // 尝试登录验证密码是否正确（传入 userId 以利用 Redis _WEU 缓存）
    try {
      await sessionService.login(studentId, password, userId);
    } catch (err) {
      const schoolError = formatSchoolError(err, '绑定失败，请稍后重试');
      return res.status(schoolError.status).json({
        success: false,
        code: schoolError.code,
        message: schoolError.message,
      });
    }

    // 加密存储密码
    const encrypted = sessionService.encrypt(password);

    // 存储绑定信息
    await store.hset(`school:user:${userId}`, {
      studentId,
      encryptedPassword: JSON.stringify(encrypted),
      boundAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: '学校账号绑定成功',
      data: { studentId },
    });
  } catch (err) {
    console.error('[SchoolBind] unexpected error:', err);
    const schoolError = formatSchoolError(err, '绑定失败，请稍后重试');
    res.status(schoolError.status).json({
      success: false,
      code: schoolError.code,
      message: schoolError.message,
    });
  }
});

/**
 * GET /api/school/status
 * 查询绑定状态
 */
router.get('/status', async (req, res) => {
  try {
    const userId = req.userId;
    const info = await store.hgetall(`school:user:${userId}`);

    if (!info || !info.studentId) {
      return res.json({
        success: true,
        data: { bound: false },
      });
    }

    res.json({
      success: true,
      data: {
        bound: true,
        studentId: info.studentId,
        boundAt: info.boundAt,
      },
    });
  } catch (err) {
    const schoolError = formatSchoolError(err, '获取绑定状态失败，请稍后重试');
    res.status(500).json({
      success: false,
      code: schoolError.code,
      message: schoolError.message,
    });
  }
});

/**
 * DELETE /api/school/bind
 * 解绑学校账号
 */
router.delete('/bind', async (req, res) => {
  try {
    const userId = req.userId;
    await store.del(`school:user:${userId}`);
    sessionService.invalidateSession(userId);

    res.json({
      success: true,
      message: '已解绑学校账号',
    });
  } catch (err) {
    const schoolError = formatSchoolError(err, '解绑失败，请稍后重试');
    res.status(500).json({
      success: false,
      code: schoolError.code,
      message: schoolError.message,
    });
  }
});

/**
 * GET /api/school/grades
 * 查询成绩
 * Query: semester (可选)
 */
router.get('/grades', async (req, res) => {
  try {
    const userId = req.userId;
    const { semester } = req.query;

    const grades = await schoolApi.getGrades(userId, semester);

    res.json({
      success: true,
      data: {
        total: grades.length,
        grades,
      },
    });
  } catch (err) {
    console.error('[SchoolGrades] error:', err);
    const schoolError = formatSchoolError(err, '查询成绩失败，请稍后重试');
    res.status(schoolError.status).json({
      success: false,
      code: schoolError.code,
      message: schoolError.message,
    });
  }
});

/**
 * GET /api/school/schedule
 * 查询课表
 * Query: semester (可选)
 */
router.get('/schedule', async (req, res) => {
  try {
    const userId = req.userId;
    const { semester } = req.query;

    const schedule = await schoolApi.getSchedule(userId, semester);

    res.json({
      success: true,
      data: {
        total: schedule.length,
        schedule,
      },
    });
  } catch (err) {
    console.error('[SchoolSchedule] error:', err);
    const schoolError = formatSchoolError(err, '查询课表失败，请稍后重试');
    res.status(schoolError.status).json({
      success: false,
      code: schoolError.code,
      message: schoolError.message,
    });
  }
});

/**
 * GET /api/school/exams
 * 查询考试安排
 * Query: semester (可选)
 */
router.get('/exams', async (req, res) => {
  try {
    const userId = req.userId;
    const { semester } = req.query;

    const exams = await schoolApi.getExams(userId, semester);

    res.json({
      success: true,
      data: {
        total: exams.length,
        exams,
      },
    });
  } catch (err) {
    console.error('[SchoolExams] error:', err);
    const schoolError = formatSchoolError(err, '查询考试失败，请稍后重试');
    res.status(schoolError.status).json({
      success: false,
      code: schoolError.code,
      message: schoolError.message,
    });
  }
});

/**
 * GET /api/school/semesters
 * 获取可用学期列表
 */
router.get('/semesters', async (req, res) => {
  try {
    const userId = req.userId;

    const semesters = await schoolApi.getSemesters(userId);

    res.json({
      success: true,
      data: { semesters },
    });
  } catch (err) {
    const schoolError = formatSchoolError(err, '获取学期列表失败，请稍后重试');
    res.status(schoolError.status).json({
      success: false,
      code: schoolError.code,
      message: schoolError.message,
    });
  }
});

module.exports = router;

