/**
 * Markdown 渲染共享配置
 *
 * 统一管理 DOMPurify 白名单、补全逻辑和转义函数，
 * 供 useMarkdownRenderer.js、MarkdownRenderer.vue 和 markdown.worker.js 共同使用。
 */

// DOMPurify 允许的 HTML 标签
export const ALLOWED_TAGS = [
  'div', 'span', 'pre', 'code', 'p', 'a', 'strong', 'em', 'b', 'i',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'button', 'svg', 'path', 'rect', 'polygon', 'br', 'hr', 'blockquote',
];

// DOMPurify 允许的属性
export const ALLOWED_ATTR = [
  'class', 'style', 'data-code', 'data-lang',
  'xmlns', 'width', 'height', 'viewBox', 'fill', 'stroke',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'x', 'y', 'rx', 'ry',
  'href', 'target', 'rel', 'points',
];

// HTML 特殊字符转义
export const escapeHtml = (str) =>
  str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
