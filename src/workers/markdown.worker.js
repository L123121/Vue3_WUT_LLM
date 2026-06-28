/**
 * Web Worker for Markdown rendering.
 * Offloads heavy markdown-it + DOMPurify processing off the main thread.
 * Handles large AI responses (>2000 chars) to avoid blocking the UI.
 */
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import { ALLOWED_TAGS, ALLOWED_ATTR, completeMarkdown, escapeHtml } from '../utils/markdownConfig.js';

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

const LANGUAGE_ALIASES = {
  js: 'javascript', ts: 'typescript', py: 'python',
  sh: 'bash', shell: 'bash', html: 'xml', vue: 'xml',
  'c++': 'cpp', golang: 'go', yml: 'yaml',
  text: 'plaintext', plaintext: 'plaintext',
};

const renderCodeBlock = (code, language, label, rawCode) => {
  const encodedCode = encodeURIComponent(code);
  const encodedRawCode = encodeURIComponent(rawCode || code);
  const isExecutable = ['javascript', 'js', 'typescript', 'ts'].includes(label.toLowerCase());
  const runButton = isExecutable
    ? `<button class="run-code-btn flex items-center gap-1.5 hover:text-green-400 transition-all duration-200 cursor-pointer px-2 py-0.5 rounded hover:bg-white/10" data-code="${encodedRawCode}" data-lang="${label}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>运行</span></button>`
    : '';
  return `<div class="code-block-wrapper my-3 rounded-lg overflow-hidden bg-[#282c34] text-white shadow-md border border-slate-700"><div class="flex items-center justify-between px-3 py-1.5 bg-[#21252b] text-xs text-gray-400 select-none border-b border-slate-700"><span class="font-mono font-medium opacity-80">${label}</span><div class="flex items-center gap-2">${runButton}<button class="copy-code-btn flex items-center gap-1.5 text-gray-300 hover:text-white transition-all duration-200 cursor-pointer px-2 py-0.5 rounded bg-slate-600/80 hover:bg-slate-500" data-code="${encodedCode}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><span class="copy-text">复制</span></button></div></div><pre class="!m-0 !p-4 overflow-x-auto bg-[#282c34] font-mono text-sm leading-normal"><code class="hljs ${language}">${code}</code></pre></div>`;
};

const highlightCode = (str, lang) => {
  const normalizedLang = (lang || '').trim().toLowerCase();
  const mappedLang = LANGUAGE_ALIASES[normalizedLang] || normalizedLang;

  if (mappedLang && hljs.getLanguage(mappedLang)) {
    try {
      const highlighted = hljs.highlight(str, { language: mappedLang, ignoreIllegals: true }).value;
      return renderCodeBlock(highlighted, `language-${mappedLang}`, mappedLang, str);
    } catch {
      // fall through
    }
  }

  try {
    const autoResult = hljs.highlightAuto(str);
    if (autoResult?.value) {
      return renderCodeBlock(autoResult.value, `language-${autoResult.language || 'text'}`, autoResult.language || 'text', str);
    }
  } catch {
    // fall through
  }

  return renderCodeBlock(escapeHtml(str), '', normalizedLang || 'text', str);
};

const md = new MarkdownIt({
  html: false,
  xhtmlOut: true,
  breaks: true,
  linkify: true,
  typographer: true,
  highlight: highlightCode,
});

createLinkSecurityRule(md);

self.onmessage = (e) => {
  const { id, content } = e.data;

  if (!content || content.trim() === '') {
    self.postMessage({ id, html: '' });
    return;
  }

  try {
    const raw = md.render(completeMarkdown(content));
    const sanitized = DOMPurify.sanitize(raw, { ALLOWED_TAGS, ALLOWED_ATTR });
    self.postMessage({ id, html: sanitized });
  } catch {
    self.postMessage({ id, html: content });
  }
};
