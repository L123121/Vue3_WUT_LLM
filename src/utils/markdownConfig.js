/**
 * Markdown 渲染共享配置
 *
 * 统一管理 DOMPurify 白名单、补全逻辑和转义函数，
 * 供 MarkdownRenderer.vue 和 markdown.worker.js 共同使用。
 */

import MarkdownIt from 'markdown-it';

// DOMPurify 允许的 HTML 标签
export const ALLOWED_TAGS = [
  'div', 'span', 'pre', 'code', 'p', 'a', 'strong', 'em', 'b', 'i',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'button', 'svg', 'path', 'rect', 'polygon', 'br', 'hr', 'blockquote',
];

// DOMPurify 允许的属性
export const ALLOWED_ATTR = [
  'class', 'style', 'data-code', 'data-lang', 'data-index',
  'xmlns', 'width', 'height', 'viewBox', 'fill', 'stroke',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'x', 'y', 'rx', 'ry',
  'href', 'target', 'rel', 'points',
];

// HTML 特殊字符转义
export const escapeHtml = (str) =>
  str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// 语言别名映射：worker 与主线程共用同一份，避免两端口径漂移
export const LANGUAGE_ALIASES = {
  javascript: 'javascript', js: 'javascript',
  typescript: 'typescript', ts: 'typescript',
  python: 'python', py: 'python',
  bash: 'bash', sh: 'bash', shell: 'bash',
  json: 'json', css: 'css',
  html: 'xml', xml: 'xml', vue: 'xml',
  java: 'java', cpp: 'cpp', 'c++': 'cpp', c: 'c',
  go: 'go', golang: 'go',
  yaml: 'yaml', yml: 'yaml',
  sql: 'sql', plaintext: 'plaintext', text: 'plaintext',
};

/** 归一化语言名并解析别名（js → javascript）；未知语言原样返回，空值返回空串 */
export const resolveLanguageAlias = (lang) => {
  const normalized = (lang || '').trim().toLowerCase();
  return LANGUAGE_ALIASES[normalized] || normalized;
};

/** 可在 CodeRunner 中直接执行的语言 */
export const isExecutableLanguage = (lang) => {
  const normalized = (lang || '').trim().toLowerCase();
  return ['javascript', 'js', 'typescript', 'ts'].includes(normalized);
};

/**
 * 代码块外壳模板 — worker 与主线程的唯一实现
 * 与 CodeRunner 按钮约定：data-code/data-lang 供事件委托读取
 */
export const renderCodeBlockHtml = (code, language, label, rawCode) => {
  const encodedCode = encodeURIComponent(code);
  const encodedRawCode = encodeURIComponent(rawCode || code);
  const runButton = isExecutableLanguage(label)
    ? `<button class="run-code-btn flex items-center gap-1.5 hover:text-green-400 transition-all duration-200 cursor-pointer px-2 py-0.5 rounded hover:bg-white/10" data-code="${encodedRawCode}" data-lang="${encodeURIComponent(label)}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>运行</span></button>`
    : '';
  return `<div class="code-block-wrapper my-3 rounded-lg overflow-hidden bg-[#282c34] text-white shadow-md border border-slate-700"><div class="flex items-center justify-between px-3 py-1.5 bg-[#21252b] text-xs text-gray-400 select-none border-b border-slate-700"><span class="font-mono font-medium opacity-80">${label}</span><div class="flex items-center gap-2">${runButton}<button class="copy-code-btn flex items-center gap-1.5 text-gray-300 hover:text-white transition-all duration-200 cursor-pointer px-2 py-0.5 rounded bg-slate-600/80 hover:bg-slate-500" data-code="${encodedCode}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><span class="copy-text">复制</span></button></div></div><pre class="!m-0 !p-4 overflow-x-auto bg-[#282c34] font-mono text-sm leading-normal"><code class="hljs ${language}">${code}</code></pre></div>`;
};

/**
 * 构造标准 MarkdownIt 实例（worker 与主线程同一套选项 + 链接安全规则）
 * @param {Function} highlight - highlight 回调，两条管线各自注入
 */
export const createMarkdownRenderer = (highlight) => {
  const md = new MarkdownIt({
    html: false,
    xhtmlOut: true,
    breaks: true,
    linkify: true,
    typographer: true,
    highlight,
  });
  createLinkSecurityRule(md);
  return md;
};

/**
 * 补全未闭合的 Markdown 语法
 * 只补全代码围栏（```），因为不闭合会影响后续内容渲染。
 */
export const completeMarkdown = (str) => {
  if (!str) return str;
  const fenceCount = (str.match(/^```/gm) || []).length;
  if (fenceCount > 0 && fenceCount % 2 === 1) return str + '\n```';
  return str;
};

/**
 * 规范化"行内"的 Markdown 块级语法
 *
 * 模型偶尔会把标题（###）、有序列表（1.）、无序列表（-）直接接在上一句后面
 * （没有换行）。markdown-it 只识别行首的块级语法，这些符号就会当普通文字显示。
 * 此函数在渲染前为其补上换行，保证块级语法正常渲染。
 * 仅处理代码围栏之外的文本，不改动代码内容。
 */
export const normalizeBlockSyntax = (str) => {
  if (!str) return str;

  const fix = (text) => text
    // 中文标点紧跟标题（#~######）：转成独立标题，缺空格时补空格
    .replace(/([。！？；：…])(\s*)(#{1,6})([ \t]?)/g, (m, p1, p2, p3, p4) => `${p1}\n\n${p3}${p4 || ' '}`)
    // 其余行内位置的二级及以上标题（行内 ## 几乎必然是标题意图）
    // 前置字符排除字母数字与 #，避免误伤 URL 片段（如 foo##bar 锚点）
    .replace(/([^A-Za-z0-9_\n#])(#{2,6})([ \t]?)/g, (m, p1, p2, p3) => `${p1}\n\n${p2}${p3 || ' '}`)
    // 中文标点紧跟有序列表序号（如 "…的项目。2. 快速原型模型"）：补空行（序号非 1 开头时空行才能成列表）
    .replace(/([。！？；])(\s*)(\d{1,2}\.)([ \t])/g, '$1\n\n$3$4')
    // 中文标点紧跟无序列表符：补空行
    .replace(/([。！？；])(-[ \t])/g, '$1\n\n$2');

  // 按 ``` 围栏切分：偶数段是正文（做规范化），奇数段是代码（保持原样）
  const segments = str.split('```');
  for (let i = 0; i < segments.length; i += 2) {
    segments[i] = fix(segments[i]);
  }
  return segments.join('```');
};

/**
 * 链接安全渲染规则（markdown-it renderer rules）
 * 为链接添加 target="_blank" 和 rel="noopener noreferrer"，并阻止危险协议
 */
export function createLinkSecurityRule(md) {
  const defaultLinkRender = md.renderer.rules.link_open ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const tIdx = tokens[idx].attrIndex('target');
    if (tIdx < 0) tokens[idx].attrPush(['target', '_blank']);
    const rIdx = tokens[idx].attrIndex('rel');
    if (rIdx < 0) tokens[idx].attrPush(['rel', 'noopener noreferrer']);
    const hIdx = tokens[idx].attrIndex('href');
    if (hIdx >= 0 && /^(javascript|data|vbscript):/i.test(tokens[idx].attrs[hIdx][1])) {
      tokens[idx].attrs[hIdx][1] = '#';
    }
    return defaultLinkRender(tokens, idx, options, env, self);
  };
}
