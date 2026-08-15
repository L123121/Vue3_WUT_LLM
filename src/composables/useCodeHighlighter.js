import { ref } from 'vue';
import hljs from 'highlight.js/lib/core';
import { escapeHtml } from '../utils/markdownConfig.js';

/**
 * 代码高亮 composable
 * 提供动态语言加载和代码高亮功能
 */
export function useCodeHighlighter() {
  const loadedLanguages = new Set();
  const highlightVersion = ref(0);

  const LANGUAGE_ALIASES = {
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

  const ensureLanguage = async (lang) => {
    if (loadedLanguages.has(lang) || hljs.getLanguage(lang)) return;
    try {
      const module = await import(`highlight.js/lib/languages/${lang}`);
      hljs.registerLanguage(lang, module.default);
      loadedLanguages.add(lang);
    } catch {
      // language not available
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
      ensureLanguage(mappedLang).then(() => {
        highlightVersion.value++;
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

  const isExecutableLanguage = (lang) => {
    const normalizedLang = (lang || '').trim().toLowerCase();
    return ['javascript', 'js', 'typescript', 'ts'].includes(normalizedLang);
  };

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
