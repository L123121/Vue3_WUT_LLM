import hljs from 'highlight.js/lib/core';
import DOMPurify from 'dompurify';
import { useCodeHighlighter } from '../composables/useCodeHighlighter.js';
import { ALLOWED_TAGS, ALLOWED_ATTR, completeMarkdown, normalizeBlockSyntax, escapeHtml, createMarkdownRenderer, renderCodeBlockHtml } from './markdownConfig.js';

/**
 * 模块级 Markdown 渲染内核。
 *
 * 此前 MarkdownIt 实例在 MarkdownRenderer 组件 setup 中构造，长会话几十个
 * 气泡 = 几十份规则表 + 链接安全规则，切换会话时全部重建。md 及其 highlight
 * 回调不依赖任何组件实例状态，收敛为模块级单例。
 * 组件层在此基础上叠加「每消息」的引用徽标与搜索词高亮。
 * 代码块外壳模板在 markdownConfig.renderCodeBlockHtml，与 worker 共享同一实现。
 */

const { getLanguageLabel, ensureLanguage, highlightVersion } = useCodeHighlighter();

// 代码高亮包装
const highlightCodeBlock = (str, lang) => {
  const normalizedLang = (lang || '').trim().toLowerCase();
  const mappedLang = getLanguageLabel(normalizedLang);

  if (mappedLang && hljs.getLanguage(mappedLang)) {
    try {
      return renderCodeBlockHtml(
        hljs.highlight(str, { language: mappedLang, ignoreIllegals: true }).value,
        `language-${mappedLang}`, mappedLang, str
      );
    } catch { /* fall through */ }
  }

  if (mappedLang) {
    // 仅语言真正可用时才触发重渲染：失败的语言没有可等的注册，bump 会造成每帧重渲染循环
    ensureLanguage(mappedLang).then((available) => {
      if (available) highlightVersion.value++;
    });
  }

  try {
    const autoResult = hljs.highlightAuto(str);
    if (autoResult?.value) {
      return renderCodeBlockHtml(autoResult.value, `language-${autoResult.language || 'text'}`, autoResult.language || 'text', str);
    }
  } catch { /* fall through */ }

  return renderCodeBlockHtml(escapeHtml(str), '', normalizedLang || 'text', str);
};

const md = createMarkdownRenderer(highlightCodeBlock);

/**
 * 渲染 Markdown 并经 DOMPurify 消毒（不含引用徽标/搜索高亮，那些依赖组件 props）
 */
export const renderSanitizedHtml = (content) => {
  if (!content || content.trim() === '') return '';
  const completed = normalizeBlockSyntax(completeMarkdown(content));
  const raw = md.render(completed);
  return DOMPurify.sanitize(raw, { ALLOWED_TAGS, ALLOWED_ATTR });
};
