/**
 * 预渲染脚本 — 登录页 Prerender
 *
 * 构建后执行，使用 Puppeteer 渲染登录页的完整 HTML，
 * 保存为 dist/login/index.html，在 JS 加载完成前用户即可看到完整的登录表单。
 *
 * 使用方式:
 *   node scripts/prerender-login.cjs
 *
 * 环境变量:
 *   PRERENDER_PORT    — 临时服务器端口（默认 4174）
 *   PUPPETEER_EXECUTABLE_PATH — Chromium 路径（默认系统安装）
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { once } = require('events');

const PORT = parseInt(process.env.PRERENDER_PORT || '4174', 10);
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const LOGIN_OUTPUT = path.join(DIST_DIR, 'login', 'index.html');

// 检测 Puppeteer 是否可用
async function loadPuppeteer() {
  try {
    // 优先使用项目安装的 puppeteer
    return require('puppeteer');
  } catch {
    try {
      // 降级到 @puppeteer/browsers 或系统 chromium
      return require('puppeteer-core');
    } catch {
      return null;
    }
  }
}

/**
 * 启动一个极简的静态文件服务器
 */
function startServer() {
  const handler = (req, res) => {
    // 所有路由返回 index.html（SPA 模式）
    const filePath = req.url === '/' || !req.url.startsWith('/assets')
      ? path.join(DIST_DIR, 'index.html')
      : path.join(DIST_DIR, req.url);

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      const mime = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
      }[ext] || 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    });
  };

  const server = http.createServer(handler);

  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[Prerender] 静态服务器已启动: http://127.0.0.1:${PORT}`);
      resolve(server);
    });
  });
}

/**
 * 使用 Puppeteer 渲染登录页
 */
async function prerenderLogin(server) {
  const puppeteer = await loadPuppeteer();
  if (!puppeteer) {
    console.warn('[Prerender] ⚠ Puppeteer 不可用，跳过预渲染');
    console.warn('[Prerender] 如需启用，请安装: npm install puppeteer');
    return false;
  }

  let browser;
  try {
    // 检测是否 puppeteer-core（无内置浏览器）
    let isCore = false;
    try {
      isCore = !puppeteer.executablePath();
    } catch {
      // executablePath() 在 puppeteer-core 中抛出异常
      isCore = true;
    }

    const launchOptions = {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--headless=new',
      ],
    };

    // 设置 Chromium 路径（优先环境变量，其次 puppeteer 内置，最后系统路径）
    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (envPath && fs.existsSync(envPath)) {
      launchOptions.executablePath = envPath;
    } else if (isCore) {
      // puppeteer-core 需要手动指定路径
      const commonPaths = [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : null,
      ].filter(Boolean);

      for (const p of commonPaths) {
        if (fs.existsSync(p)) {
          launchOptions.executablePath = p;
          break;
        }
      }

      if (!launchOptions.executablePath) {
        console.warn('[Prerender] ⚠ 未找到 Chromium，跳过预渲染');
        console.warn('[Prerender] 可设置 PUPPETEER_EXECUTABLE_PATH 指定路径');
        return false;
      }
    }

    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    // 设置视口（移动端）
    await page.setViewport({ width: 375, height: 812 });

    console.log('[Prerender] 正在渲染登录页...');

    // 导航到登录页，等待网络空闲
    await page.goto(`http://127.0.0.1:${PORT}/login`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    // 额外等待 Vue 挂载完成
    await page.waitForFunction(() => {
      return document.querySelector('#app')?.children?.length > 0;
    }, { timeout: 10000 });

    // 等待所有图片加载完成
    await page.waitForFunction(() => {
      const imgs = document.querySelectorAll('img');
      return Array.from(imgs).every(img => img.complete);
    }, { timeout: 10000 });

    // 获取完整的 HTML
    const html = await page.evaluate(() => {
      const doctype = '<!DOCTYPE html>';
      const rootHtml = document.documentElement.outerHTML;
      return doctype + '\n' + rootHtml;
    });

    // 保存到 dist/login/index.html
    fs.mkdirSync(path.dirname(LOGIN_OUTPUT), { recursive: true });
    fs.writeFileSync(LOGIN_OUTPUT, html, 'utf-8');

    const sizeKb = (Buffer.byteLength(html, 'utf-8') / 1024).toFixed(1);
    console.log(`[Prerender] ✓ 登录页已预渲染: ${LOGIN_OUTPUT} (${sizeKb} KB)`);

    // 验证内容
    if (html.includes('login') || html.includes('学号') || html.includes('密码')) {
      console.log('[Prerender] ✓ 内容验证通过');
    } else {
      console.warn('[Prerender] ⚠ 内容可能不完整，请检查');
    }

    return true;
  } catch (err) {
    console.error('[Prerender] ❌ 预渲染失败:', err.message);
    return false;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * 主流程
 */
async function main() {
  console.log('[Prerender] ====== 登录页预渲染开始 ======');

  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    console.error('[Prerender] ❌ dist/index.html 不存在，请先运行 npm run build');
    process.exit(1);
  }

  const server = await startServer();
  let success = false;

  try {
    success = await prerenderLogin(server);
  } finally {
    // 关闭服务器
    await new Promise((resolve) => server.close(resolve));
    console.log('[Prerender] 静态服务器已关闭');
  }

  if (success) {
    console.log('[Prerender] ====== 预渲染完成 ======');
  } else {
    console.log('[Prerender] ====== 预渲染已跳过（不影响构建） ======');
  }
}

main().catch((err) => {
  console.error('[Prerender] 意外错误:', err);
  process.exit(1);
});