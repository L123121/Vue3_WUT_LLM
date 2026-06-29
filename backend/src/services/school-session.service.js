/**
 * 学校教务系统 Session 管理服务
 * 使用 Puppeteer 自动完成 CAS 登录，提取教务系统 Cookie
 * _WEU 令牌持久化到 Redis，减少 Puppeteer 调用次数
 */

const crypto = require('crypto');
const config = require('../config');
const { redis: store } = require('./memory-store');

const ALGORITHM = 'aes-256-gcm';
const WEU_CACHE_KEY = (userId) => `school:weu:${userId}`;
const WEU_CACHE_TTL = 24 * 60 * 60; // 24 小时

const createSchoolError = (code, message, cause) => {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
};

class SchoolSessionService {
  constructor() {
    // userId -> { cookies: string, expiresAt: number }
    this.sessions = new Map();
    this._puppeteer = null;
  }

  // ==================== Session 管理 ====================

  /**
   * 获取用户的有效 Session Cookie
   * 优先从 Redis 读取缓存的 _WEU 令牌，命中则直接返回，无需 Puppeteer
   * 缓存未命中时才走 Puppeteer 登录流程
   */
  async getSession(userId, studentId, password) {
    // 1. 先查内存缓存
    const memoryCached = this.sessions.get(userId);
    if (memoryCached && memoryCached.expiresAt > Date.now()) {
      return memoryCached.cookies;
    }

    // 2. 再查 Redis 持久化缓存（完整 Cookie 字符串）
    const cachedCookies = await this._getCookiesFromRedis(userId);
    if (cachedCookies) {
      // 回写内存缓存，避免下次再查 Redis
      this.sessions.set(userId, {
        cookies: cachedCookies,
        expiresAt: Date.now() + config.school.sessionTTL,
      });
      console.log(`[SchoolSession] Redis 命中 Cookie 缓存: ${userId}`);
      return cachedCookies;
    }

    // 3. Redis 也未命中，走 Puppeteer 登录
    if (!studentId || !password) {
      throw createSchoolError(
        'MISSING_CREDENTIALS',
        '学校账号未绑定，请先在设置中绑定教务系统账号'
      );
    }

    const cookies = await this.login(studentId, password);

    // 回写内存缓存
    this.sessions.set(userId, {
      cookies,
      expiresAt: Date.now() + config.school.sessionTTL,
    });

    return cookies;
  }

  /**
   * 清除用户的 Session 缓存
   */
  invalidateSession(userId) {
    this.sessions.delete(userId);
    store.del(WEU_CACHE_KEY(userId)).catch(() => {});
  }

  // ==================== Redis Cookie 缓存 ====================

  /**
   * 从 Redis 读取缓存的完整 Cookie 字符串
   * @param {string} userId
   * @returns {string|null} Cookie 字符串，不存在返回 null
   */
  async _getCookiesFromRedis(userId) {
    try {
      const val = await store.hget(WEU_CACHE_KEY(userId), 'cookies');
      return val || null;
    } catch {
      return null;
    }
  }

  /**
   * 将完整 Cookie 字符串写入 Redis 缓存
   * @param {string} userId
   * @param {string} cookieStr - 完整 Cookie 字符串
   */
  async _cacheCookies(userId, cookieStr) {
    try {
      const pipe = store.pipeline();
      pipe.hset(WEU_CACHE_KEY(userId), 'cookies', cookieStr);
      pipe.expire(WEU_CACHE_KEY(userId), WEU_CACHE_TTL);
      await pipe.exec();
    } catch (err) {
      console.error('[SchoolSession] 缓存 Cookie 失败:', err.message);
    }
  }

  // ==================== Puppeteer 登录 ====================

  /**
   * 通过 Puppeteer 自动完成 CAS 登录，提取教务系统 Cookie
   * 优先检查 Redis 中缓存的 _WEU 令牌，命中则跳过 Puppeteer
   *
   * 流程：jwxt 内部登录页 → 点击「统一身份认证」→ CAS 填表 → 跳转回 jwxt → 提取 Cookie
   *
   * @param {string} studentId - 学号
   * @param {string} password - 教务系统密码
   * @param {string} [userId] - 系统用户 ID（用于 Redis 缓存查找）
   * @returns {string} Cookie 字符串
   */
  async login(studentId, password, userId) {
    // 如果提供了 userId，先检查 Redis 缓存
    if (userId) {
      const cachedCookies = await this._getCookiesFromRedis(userId);
      if (cachedCookies) {
        console.log(`[SchoolSession] Redis 命中 Cookie 缓存，跳过 Puppeteer: ${userId}`);
        return cachedCookies;
      }
    }

    let browser = null;

    try {
      const puppeteer = await this._getPuppeteer();

      const launchOpts = {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
      };
      // 支持通过环境变量指定 Chrome 路径（Docker 部署用系统 chromium）
      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      }
      browser = await puppeteer.launch(launchOpts);
      console.log('[SchoolSession] 已启动无头浏览器');

      const page = await browser.newPage();
      await page.setBypassCSP(true);

      // Step 1: 打开 jwxt 内部登录页
      const jwxtLoginUrl = `${config.school.jwHost}/jwapp/sys/yjsrzfwapp/dbLogin/main.do`;
      console.log('[SchoolSession] 打开教务系统登录页...');
      try {
        await page.goto(jwxtLoginUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      } catch (e) {
        console.warn('[SchoolSession] jwxt 首页加载超时，继续执行:', e.message);
      }
      await new Promise(r => setTimeout(r, 2000));

      // Step 2: 点击「统一身份认证」按钮
      console.log('[SchoolSession] 点击统一身份认证...');
      const casBtn = await page.$('#tyrzBtn');
      if (!casBtn) {
        throw createSchoolError('SERVICE_UNAVAILABLE', '未找到统一身份认证按钮，教务系统页面可能已变更');
      }

      // 监听页面上所有 frame 的导航事件，检测 CAS 跳转
      // 用 25 秒超时兜底，防止 Promise 永远不 resolve
      console.log('[SchoolSession] 设置 CAS 跳转监听...');
      let redirectResolved = false;
      const redirectPromise = new Promise((resolve) => {
        const handler = async (framed) => {
          try {
            if (redirectResolved) return;
            const url = framed.url();
            if (url.includes('tpass/login')) {
              redirectResolved = true;
              page.off('framenavigated', handler);
              console.log('[SchoolSession] 检测到 CAS 登录页:', url.substring(0, 80));
              if (url.includes('zhlgd.whut.edu.cn')) {
                const newUrl = url.replace('zhlgd.whut.edu.cn', 'one.whut.edu.cn');
                console.log(`[SchoolSession] 检测到旧域名跳转，自动修正: ${newUrl}`);
                resolve(await page.goto(newUrl, { waitUntil: 'networkidle2', timeout: 20000 }));
              } else {
                resolve();
              }
            }
          } catch (e) {
            console.warn('[SchoolSession] framenavigated handler 异常:', e.message);
          }
        };
        page.on('framenavigated', handler);
        // 25 秒超时兜底
        setTimeout(() => {
          if (!redirectResolved) {
            redirectResolved = true;
            page.off('framenavigated', handler);
            console.log('[SchoolSession] redirectPromise 超时，继续执行');
            resolve();
          }
        }, 25000);
      });

      await casBtn.click();
      console.log('[SchoolSession] 已点击 CAS 按钮，等待跳转...');
      await redirectPromise;
      console.log('[SchoolSession] redirectPromise 已完成');

      // 等待 CAS 登录页加载
      const casLoginUrl = page.url();
      console.log(`[SchoolSession] 点击后 URL: ${casLoginUrl.substring(0, 100)}`);
      // 兜底修正域名
      if (casLoginUrl.includes('zhlgd.whut.edu.cn/tpass/login')) {
        const newUrl = casLoginUrl.replace('zhlgd.whut.edu.cn', 'one.whut.edu.cn');
        console.log(`[SchoolSession] 兜底修正域名: ${newUrl}`);
        await page.goto(newUrl, { waitUntil: 'networkidle2', timeout: 20000 });
      }

      // 判断是否成功进入 CAS 登录页
      const finalUrl = page.url();
      console.log(`[SchoolSession] CAS 登录页最终 URL: ${finalUrl.substring(0, 100)}`);

      if (!finalUrl.includes('tpass/login')) {
        // 如果没有跳转到 CAS 登录页，可能是直接进了 jwxt（已有登录态）
        console.log('[SchoolSession] 未进入 CAS 登录页，可能已有登录态');
      } else {
        // 等待用户名输入框出现
        console.log('[SchoolSession] 等待 #un 输入框...');
        try {
          await page.waitForSelector('#un', { timeout: 20000 });
          console.log('[SchoolSession] #un 输入框已就绪');
        } catch (e) {
          console.warn('[SchoolSession] #un 输入框等待超时:', e.message);
        }
        await new Promise(r => setTimeout(r, 1000));

        // Step 3: 填入账号密码
        console.log('[SchoolSession] 填入账号密码...');
        await page.type('#un', studentId, { delay: 20 });
        await page.type('#pd', password, { delay: 20 });

        // Step 4: 提交登录
        console.log('[SchoolSession] 提交 CAS 登录...');
        await page.click('#index_login_btn');
      }

      // 轮询等待 _WEU Cookie（jwxt SPA 通过 JS 异步设置 Cookie）
      console.log('[SchoolSession] 等待 Cookie 设置...');
      await this._waitForWeuCookie(page);

      const currentUrl = page.url();
      console.log('[SchoolSession] 当前页面:', currentUrl);

      // 检查是否还在 CAS 登录页（登录失败）
      if (currentUrl.includes('tpass/login')) {
        const errorMsg = await page.evaluate(() => {
          const el = document.getElementById('errormsg');
          return el ? el.textContent.trim() : '';
        });
        throw createSchoolError(
          'INVALID_CREDENTIALS',
          errorMsg || '学号或密码错误，请重新输入'
        );
      }

      // 提取 jwxt Cookie
      const allCookies = await page.cookies();
      const jwxtCookies = allCookies.filter(c => c.domain && (c.domain === 'jwxt.whut.edu.cn' || c.domain.endsWith('.whut.edu.cn')));
      const cookieStr = jwxtCookies.map(c => `${c.name}=${c.value}`).join('; ');

      if (!cookieStr) {
        throw createSchoolError(
          'SERVICE_UNAVAILABLE',
          '登录成功但未获取到教务系统会话，请稍后重试'
        );
      }

      console.log('[SchoolSession] 登录成功，获取到', jwxtCookies.length, '个 Cookie:', jwxtCookies.map(c => c.name).join(', '));

      // 缓存完整 Cookie 字符串到 Redis
      if (userId) {
        await this._cacheCookies(userId, cookieStr);
        console.log(`[SchoolSession] Cookie 已缓存到 Redis: ${userId}`);
      }

      return cookieStr;
    } catch (error) {
      throw this._normalizeLoginError(error);
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  /**
   * 懒加载 puppeteer
   */
  async _getPuppeteer() {
    if (!this._puppeteer) {
      try {
        this._puppeteer = require('puppeteer');
      } catch {
        this._puppeteer = require('puppeteer-core');
      }
    }
    return this._puppeteer;
  }

  // ==================== 加密工具 ====================

  /**
   * AES-256-GCM 加密
   */
  encrypt(text) {
    const key = this._getEncKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag().toString('hex');

    return {
      iv: iv.toString('hex'),
      tag,
      data: encrypted,
    };
  }

  /**
   * AES-256-GCM 解密
   */
  decrypt(encryptedObj) {
    const key = this._getEncKey();
    const { iv, tag, data } = encryptedObj;

    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tag, 'hex'));

    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  // ==================== 内部工具 ====================

  _getEncKey() {
    const raw = config.school.encKey;
    return crypto.createHash('sha256').update(raw).digest();
  }

  _normalizeLoginError(error) {
    if (error?.code === 'INVALID_CREDENTIALS' || error?.code === 'SERVICE_UNAVAILABLE' || error?.code === 'MISSING_CREDENTIALS') {
      return error;
    }

    if (error?.name === 'TimeoutError' || error?.message?.includes('timeout')) {
      return createSchoolError(
        'NETWORK_ERROR',
        '连接教务系统超时，请检查网络后重试',
        error
      );
    }

    if (error?.message?.includes('net::') || error?.code === 'ECONNREFUSED') {
      return createSchoolError(
        'NETWORK_ERROR',
        '网络连接失败，暂时无法访问教务系统',
        error
      );
    }

    return createSchoolError(
      'UNKNOWN_ERROR',
      '登录时发生异常: ' + (error?.message || '未知错误'),
      error
    );
  }

  /**
   * 轮询等待 _WEU Cookie 出现（jwxt 通过 JS 异步设置 Cookie）
   * @param {Page} page
   * @returns {Promise<void>}
   */
  async _waitForWeuCookie(page) {
    const maxAttempts = 12;  // 6 秒总等待（12 × 500ms），比之前 10 秒快
    const interval = 500;

    for (let i = 0; i < maxAttempts; i++) {
      // 检查是否还在 CAS 登录页（密码错误时快速返回）
      const currentUrl = page.url();
      if (currentUrl.includes('tpass/login')) {
        // 尝试读取错误信息
        const loginFailed = await page.evaluate(() => {
          const el = document.getElementById('errormsg');
          if (el && window.getComputedStyle(el).display !== 'none') {
            return el.textContent.trim();
          }
          return null;
        });
        if (loginFailed) {
          throw createSchoolError('INVALID_CREDENTIALS', loginFailed);
        }
      }

      const allCookies = await page.cookies();
      const jwxtCookies = allCookies.filter(c => c.domain.includes('jwxt'));
      const hasWeu = jwxtCookies.some(c => c.name === '_WEU');

      if (hasWeu) {
        console.log(`[SchoolSession] _WEU Cookie 已就绪 (${(i + 1) * interval}ms)`);
        return;
      }

      await new Promise(r => setTimeout(r, interval));
    }

    console.warn('[SchoolSession] 等待 _WEU Cookie 超时，使用已有 Cookie');
  }
}

// 单例导出
module.exports = new SchoolSessionService();
