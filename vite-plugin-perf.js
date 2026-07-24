/**
 * vite-plugin-perf — 前端性能优化 Vite 插件
 *
 * 功能:
 *  1. Preload: 自动向 HTML 注入 <link rel="preload" as="style"> 指向 CSS 产出文件
 *  2. 关键 CSS 内联: 提取首屏关键样式（body 背景色、骨架屏动画等）内联到 <style> 标签
 *     避免 Tailwind 全量 CSS 加载前出现白屏 / FOUC
 *  3. CDN 支持: 为所有资源引用添加 CDN 域名前缀
 *
 * 使用方式 (vite.config.js):
 *   import { perfOptimizePlugin } from './vite-plugin-perf.js';
 *   export default defineConfig({
 *     plugins: [vue(), perfOptimizePlugin({ cdnUrl: process.env.VITE_CDN_URL })],
 *   });
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * 关键 CSS 模板 — 在 Tailwind CSS 加载完成前保证首屏可见
 * 目前包含: body 背景色、骨架屏动画、基本布局、滚动条样式
 */
function getCriticalCss() {
  return `
/* ── 关键 CSS: 在 Tailwind 加载前保证首屏可见 ── */
body {
  margin: 0;
  background-color: #f8fafc;
  font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
}
.dark body,
body.dark {
  background-color: #030712;
}

/* 骨架屏 shimmer 动画 */
@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
.skeleton-shimmer {
  position: relative;
  overflow: hidden;
}
.skeleton-shimmer::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
  animation: shimmer 1.5s ease-in-out infinite;
}
.dark .skeleton-shimmer::after {
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
}

/* 基本布局保证 */
#app {
  min-height: 100vh;
}

/* 滚动条样式（关键, 避免布局偏移） */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 9999px; }
`.trim();
}

/**
 * @param {object} options
 * @param {string} [options.cdnUrl] — CDN 域名前缀，如 https://cdn.example.com
 * @param {boolean} [options.criticalCss=true] — 是否启用关键 CSS 内联
 * @returns {import('vite').Plugin}
 */
export function perfOptimizePlugin(options = {}) {
  const {
    cdnUrl = '',
    criticalCss = true,
  } = options;

  /** @type {string[]} 收集构建产出的 CSS 文件名 */
  let cssFiles = [];

  return {
    name: 'vite-plugin-perf',
    enforce: 'post',
    apply: 'build', // 仅在构建时生效

    // === 1. 收集 CSS 产出文件 ===
    generateBundle(_, bundle) {
      cssFiles = [];
      for (const [key, value] of Object.entries(bundle)) {
        if (key.endsWith('.css') && value.type === 'asset') {
          cssFiles.push(key);
        }
      }
    },

    // === 2. 注入 Preload + 关键 CSS + 非阻塞 CSS 加载 ===
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        // 只在构建时注入（ctx.bundle 在构建时存在）
        if (!ctx.bundle) return html;

        // 2a. 为每个 CSS 文件生成 preload 链接
        const preloadLinks = cssFiles
          .map((file) => {
            const href = cdnUrl ? `${cdnUrl}/${file}` : `/${file}`;
            return `    <link rel="preload" href="${href}" as="style" crossorigin="anonymous">`;
          })
          .join('\n');

        // 2b. 生成关键 CSS 内联块
        let injectContent = '';
        if (criticalCss) {
          const css = getCriticalCss();
          injectContent = `  <style>\n${css}\n  </style>\n`;
        }

        // 2c. 将 CSS link 替换为非阻塞加载（media="print" onload="this.media='all'"）
        // 关键 CSS 已内联，完整 CSS 可以异步加载
        let transformed = html;
        if (criticalCss) {
          transformed = transformed.replace(
            /<link rel="stylesheet" crossorigin href="([^"]+\.css)">/g,
            (match, href) =>
              `<link rel="stylesheet" href="${href}" media="print" onload="this.media='all'">\n    <noscript>${match}</noscript>`
          );
        }

        // 2d. 插入到 </head> 之前
        const toInject = `${injectContent}${preloadLinks ? preloadLinks + '\n' : ''}  </head>`;
        return transformed.replace('</head>', toInject);
      },
    },
  };
}