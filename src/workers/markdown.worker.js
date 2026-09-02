/**
 * Web Worker for Markdown rendering.
 * Offloads heavy markdown-it + DOMPurify processing off the main thread.
 * Handles large AI responses (>2000 chars) to avoid blocking the UI.
 */
import hljs from 'highlight.js/lib/core';
import { completeMarkdown, normalizeBlockSyntax, escapeHtml, resolveLanguageAlias, renderCodeBlockHtml, createMarkdownRenderer } from '../utils/markdownConfig.js';

// Register common languages in the worker
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import go from 'highlight.js/lib/languages/go';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('go', go);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('sql', sql);

// 代码块外壳模板与语言别名判定在 markdownConfig（与主线程共享同一实现）

const highlightCode = (str, lang) => {
  const normalizedLang = (lang || '').trim().toLowerCase();
  const mappedLang = resolveLanguageAlias(normalizedLang);

  if (mappedLang && hljs.getLanguage(mappedLang)) {
    try {
      const highlighted = hljs.highlight(str, { language: mappedLang, ignoreIllegals: true }).value;
      return renderCodeBlockHtml(highlighted, `language-${mappedLang}`, mappedLang, str);
    } catch {
      // fall through
    }
  }

  try {
    const autoResult = hljs.highlightAuto(str);
    if (autoResult?.value) {
      return renderCodeBlockHtml(autoResult.value, `language-${autoResult.language || 'text'}`, autoResult.language || 'text', str);
    }
  } catch {
    // fall through
  }

  return renderCodeBlockHtml(escapeHtml(str), '', normalizedLang || 'text', str);
};

const md = createMarkdownRenderer(highlightCode);

self.onmessage = (e) => {
  const { id, content } = e.data;

  if (!content || content.trim() === '') {
    self.postMessage({ id, html: '' });
    return;
  }

  try {
    const raw = md.render(normalizeBlockSyntax(completeMarkdown(content)));
    self.postMessage({ id, html: raw });
  } catch {
    self.postMessage({ id, html: '' });
  }
};
