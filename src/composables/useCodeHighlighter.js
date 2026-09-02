import { ref } from 'vue';
import hljs from 'highlight.js/lib/core';
import { escapeHtml, LANGUAGE_ALIASES, isExecutableLanguage } from '../utils/markdownConfig.js';

/**
 * 代码高亮 composable
 * 提供动态语言加载和代码高亮功能
 *
 * 状态为模块级共享：hljs 注册表本身是全局单例，语言加载记录与版本号也必须全局，
 * 否则每个 MarkdownRenderer 实例各自维护一份 loadedLanguages，重复加载同一语言
 * 且各实例 highlightVersion 不联动（其他实例高亮完成后不会触发重渲染）。
 */

const loadedLanguages = new Set();
// 导入失败的语言负缓存：否则流式期间每个含 ```mermaid 等未注册语言的 chunk
// 都会重试一次动态 import（约每 150ms 一次失败请求），且永不自愈
const failedLanguages = new Set();
const highlightVersion = ref(0);

const ensureLanguage = async (lang) => {
  if (loadedLanguages.has(lang) || hljs.getLanguage(lang)) return true;
  if (failedLanguages.has(lang)) return false;
  try {
    const module = await import(`highlight.js/lib/languages/${lang}`);
    hljs.registerLanguage(lang, module.default);
    loadedLanguages.add(lang);
    return true;
  } catch {
    failedLanguages.add(lang);
    return false;
  }
};

const highlightCode = (str, lang) => {
  const normalizedLang = (lang || '').trim().toLowerCase();
  const mappedLang = LANGUAGE_ALIASES[normalizedLang] || normalizedLang;

  if (mappedLang && hljs.getLanguage(mappedLang)) {
    try {
      return hljs.highlight(str, { language: mappedLang, ignoreIllegals: true }).value;
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
      return autoResult.value;
    }
  } catch { /* fall through */ }

  return escapeHtml(str);
};

const getLanguageLabel = (lang) => {
  const normalizedLang = (lang || '').trim().toLowerCase();
  return LANGUAGE_ALIASES[normalizedLang] || normalizedLang || 'text';
};

export function useCodeHighlighter() {
  return {
    loadedLanguages,
    highlightVersion,
    highlightCode,
    getLanguageLabel,
    isExecutableLanguage,
    escapeHtml,
    ensureLanguage,
  };
}
