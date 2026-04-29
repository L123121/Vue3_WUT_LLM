<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import DOMPurify from 'dompurify';
import CodeRunner from './CodeRunner.vue';
import 'highlight.js/styles/atom-one-dark.css';

// 静态导入常用语言
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import java from 'highlight.js/lib/languages/java';
import go from 'highlight.js/lib/languages/go';
import cpp from 'highlight.js/lib/languages/cpp';
import c from 'highlight.js/lib/languages/c';

// 注册所有语言
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('java', java);
hljs.registerLanguage('go', go);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', c);

const props = defineProps({ content: { type: String, default: '' } });
const emit = defineEmits(['copyCode']);

// 代码运行器状态
const showRunner = ref(false);
const runnerCode = ref('');
const runnerLanguage = ref('javascript');

// 所有支持的语言映射
const LANGUAGE_ALIASES = {
  // JavaScript
  javascript: 'javascript',
  js: 'javascript',
  // TypeScript
  typescript: 'typescript',
  ts: 'typescript',
  // Python
  python: 'python',
  py: 'python',
  // Bash
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  // JSON
  json: 'json',
  // CSS
  css: 'css',
  // HTML/XML
  html: 'xml',
  xml: 'xml',
  vue: 'xml',
  // Java
  java: 'java',
  // C/C++
  cpp: 'cpp',
  'c++': 'cpp',
  c: 'c',
  // Go
  go: 'go',
  golang: 'go',
  // YAML
  yaml: 'yaml',
  yml: 'yaml',
  // SQL
  sql: 'sql',
  // Plain text
  plaintext: 'plaintext',
  text: 'plaintext',
};

// 获取语言
const getLanguage = (langName) => {
  const normalizedLang = LANGUAGE_ALIASES[langName.toLowerCase()] || langName.toLowerCase();
  return hljs.getLanguage(normalizedLang) ? normalizedLang : null;
};

const escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * 栈匹配补全：检测未闭合的 Markdown 标签并补全
 * 解决流式输出时渲染"乱跳"的问题
 */
const completeMarkdown = (str) => {
  if (!str) return str;

  const stack = [];
  let i = 0;
  const len = str.length;

  while (i < len) {
    // 跳过已转义的字符
    if (str[i] === '\\' && i + 1 < len) {
      i += 2;
      continue;
    }

    // 代码块 ``` (优先级最高，内部不解析其他语法)
    if (str.slice(i, i + 3) === '```') {
      // 查找语言标识符结束位置
      let langEnd = i + 3;
      while (langEnd < len && str[langEnd] !== '\n' && str[langEnd] !== '\r') {
        langEnd++;
      }

      // 查找闭合的 ```
      let closeIdx = str.indexOf('```', langEnd);
      if (closeIdx === -1) {
        // 未闭合，压栈
        stack.push({ type: 'code', pos: i });
        break; // 代码块内不解析其他内容
      } else {
        i = closeIdx + 3;
        continue;
      }
    }

    // 行内代码 ` (单个反引号)
    if (str[i] === '`' && str.slice(i, i + 3) !== '```') {
      // 查找闭合的 `
      let closeIdx = str.indexOf('`', i + 1);
      if (closeIdx === -1) {
        stack.push({ type: 'inlineCode', pos: i });
        i++;
      } else {
        i = closeIdx + 1;
      }
      continue;
    }

    // 粗体 ** 或 __
    if ((str.slice(i, i + 2) === '**' || str.slice(i, i + 2) === '__')) {
      const marker = str.slice(i, i + 2);
      // 查找闭合
      let closeIdx = str.indexOf(marker, i + 2);
      if (closeIdx === -1) {
        stack.push({ type: 'bold', marker, pos: i });
        i += 2;
      } else {
        i = closeIdx + 2;
      }
      continue;
    }

    // 删除线 ~~
    if (str.slice(i, i + 2) === '~~') {
      let closeIdx = str.indexOf('~~', i + 2);
      if (closeIdx === -1) {
        stack.push({ type: 'del', marker: '~~', pos: i });
        i += 2;
      } else {
        i = closeIdx + 2;
      }
      continue;
    }

    // 斜体 * 或 _ (单个，需要排除 ** 和 __)
    if ((str[i] === '*' || str[i] === '_') && str[i + 1] !== str[i]) {
      const marker = str[i];
      // 查找闭合，注意不能匹配到 ** 或 __
      let j = i + 1;
      let found = false;
      while (j < len) {
        if (str[j] === marker && str[j + 1] !== marker) {
          // 检查前面不是同样的字符（避免匹配到 ** 的中间）
          if (j > 0 && str[j - 1] !== marker) {
            found = true;
            break;
          }
        }
        j++;
      }
      if (!found) {
        stack.push({ type: 'italic', marker, pos: i });
        i++;
      } else {
        i = j + 1;
      }
      continue;
    }

    // 表格：检测是否在表格环境中
    // 简化处理：如果当前行包含 | 且下一行也有 |，认为是表格
    if (str[i] === '|') {
      // 找到当前行的结尾
      let lineEnd = str.indexOf('\n', i);
      if (lineEnd === -1) lineEnd = len;

      // 检查是否在表格中（前面是否有表格分隔行）
      const beforeContent = str.slice(0, i);
      const lastNewline = beforeContent.lastIndexOf('\n');
      const prevLineStart = lastNewline === -1 ? 0 : lastNewline + 1;
      const prevLine = str.slice(prevLineStart, i);

      // 如果当前行有多个 |，标记为可能的表格行
      const currentLine = str.slice(i, lineEnd);
      const pipeCount = (currentLine.match(/\|/g) || []).length;

      if (pipeCount >= 2) {
        // 检查是否有表格闭合（后面是否有空行或非表格行）
        let tableEnd = str.indexOf('\n\n', lineEnd);
        if (tableEnd === -1 && lineEnd < len) {
          // 没有空行结束，可能表格未闭合
          // 简化：添加一个换行来"闭合"表格
          if (!stack.find(item => item.type === 'table')) {
            stack.push({ type: 'table', pos: i });
          }
        }
      }
    }

    i++;
  }

  // 根据栈内容补全闭合符号
  let result = str;
  const closers = [];

  for (let j = stack.length - 1; j >= 0; j--) {
    const item = stack[j];
    switch (item.type) {
      case 'code':
        closers.push('```');
        break;
      case 'inlineCode':
        closers.push('`');
        break;
      case 'bold':
        closers.push(item.marker);
        break;
      case 'italic':
        closers.push(item.marker);
        break;
      case 'del':
        closers.push('~~');
        break;
      case 'table':
        closers.push('\n');
        break;
    }
  }

  if (closers.length > 0) {
    result = str + closers.join('');
  }

  return result;
};

const renderCodeBlock = (code, language, label, rawCode) => {
  const encodedCode = encodeURIComponent(code);
  const encodedRawCode = encodeURIComponent(rawCode || code);
  // 判断是否可执行（仅 JavaScript）
  const isExecutable = ['javascript', 'js', 'typescript', 'ts'].includes(label.toLowerCase());
  const runButton = isExecutable
    ? `<button class="run-code-btn flex items-center gap-1.5 hover:text-green-400 transition-all duration-200 cursor-pointer px-2 py-0.5 rounded hover:bg-white/10" data-code="${encodedRawCode}" data-lang="${label}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>运行</span></button>`
    : '';
  return `<div class="code-block-wrapper my-3 rounded-lg overflow-hidden bg-[#282c34] text-white shadow-md border border-slate-700"><div class="flex items-center justify-between px-3 py-1.5 bg-[#21252b] text-xs text-gray-400 select-none border-b border-slate-700"><span class="font-mono font-medium opacity-80">${label}</span><div class="flex items-center gap-2">${runButton}<button class="copy-code-btn flex items-center gap-1.5 text-gray-300 hover:text-white transition-all duration-200 cursor-pointer px-2 py-0.5 rounded bg-slate-600/80 hover:bg-slate-500" data-code="${encodedCode}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><span class="copy-text">复制</span></button></div></div><pre class="!m-0 !p-4 overflow-x-auto bg-[#282c34] font-mono text-sm leading-normal"><code class="hljs ${language}">${code}</code></pre></div>`;
};

const highlightCode = (str, lang) => {
  const normalizedLang = (lang || '').trim().toLowerCase();
  const mappedLang = LANGUAGE_ALIASES[normalizedLang] || normalizedLang;

  // 如果语言已加载，直接高亮
  if (mappedLang && hljs.getLanguage(mappedLang)) {
    try {
      const highlighted = hljs.highlight(str, { language: mappedLang, ignoreIllegals: true }).value;
      return renderCodeBlock(highlighted, `language-${mappedLang}`, mappedLang, str);
    } catch {}
  }

  // 尝试自动检测
  try {
    const autoResult = hljs.highlightAuto(str, COMMON_LANGUAGES);
    if (autoResult?.value) {
      const detectedLang = autoResult.language || mappedLang || 'text';
      return renderCodeBlock(autoResult.value, `language-${detectedLang}`, detectedLang, str);
    }
  } catch {}

  // 降级：纯文本
  return renderCodeBlock(escapeHtml(str), '', normalizedLang || 'text', str);
};

const md = new MarkdownIt({ html: false, xhtmlOut: true, breaks: true, linkify: true, typographer: true, highlight: highlightCode });

// 链接安全处理：阻止 javascript: 和 data: 协议，添加 noopener
const defaultLinkOpenRender = md.renderer.rules.link_open || function(tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.link_open = function(tokens, idx, options, env, self) {
  // 添加 target="_blank"
  const targetIndex = tokens[idx].attrIndex('target');
  if (targetIndex < 0) {
    tokens[idx].attrPush(['target', '_blank']);
  }
  // 添加 rel="noopener noreferrer"
  const relIndex = tokens[idx].attrIndex('rel');
  if (relIndex < 0) {
    tokens[idx].attrPush(['rel', 'noopener noreferrer']);
  }
  // 阻止危险协议
  const hrefIndex = tokens[idx].attrIndex('href');
  if (hrefIndex >= 0) {
    const href = tokens[idx].attrs[hrefIndex][1];
    if (/^(javascript|data|vbscript):/i.test(href)) {
      tokens[idx].attrs[hrefIndex][1] = '#';
    }
  }
  return defaultLinkOpenRender(tokens, idx, options, env, self);
};

// DOMPurify 允许的标签和属性
const ALLOWED_TAGS = [
  'div', 'span', 'pre', 'code', 'p', 'a', 'strong', 'em', 'b', 'i',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'button', 'svg', 'path', 'rect', 'polygon', 'br', 'hr', 'blockquote'
];
const ALLOWED_ATTR = [
  'class', 'style', 'data-code', 'data-lang',
  // SVG 属性
  'xmlns', 'width', 'height', 'viewBox', 'fill', 'stroke',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'x', 'y', 'rx', 'ry',
  // 链接属性
  'href', 'target', 'rel',
  // SVG polygon points
  'points'
];

const renderedContent = computed(() => {
  if (!props.content || props.content.trim() === '') return '';
  try {
    // 先补全未闭合的 Markdown 标签，再渲染
    const completed = completeMarkdown(props.content);
    const raw = md.render(completed);
    return DOMPurify.sanitize(raw, { ALLOWED_TAGS, ALLOWED_ATTR });
  } catch (error) {
    console.error('Markdown rendering error:', error);
    return props.content;
  }
});

const handleClick = (event) => {
  // 处理复制按钮
  const copyBtn = event.target.closest('.copy-code-btn');
  if (copyBtn) {
    const code = decodeURIComponent(copyBtn.getAttribute('data-code') || '');
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      emit('copyCode', code);
      const textSpan = copyBtn.querySelector('.copy-text');
      if (textSpan) {
        const originalText = textSpan.innerHTML;
        textSpan.innerHTML = '<span class="text-green-400">已复制</span>';
        setTimeout(() => { textSpan.innerHTML = originalText; }, 2000);
      }
    });
    return;
  }

  // 处理运行按钮
  const runBtn = event.target.closest('.run-code-btn');
  if (runBtn) {
    const code = decodeURIComponent(runBtn.getAttribute('data-code') || '');
    const lang = runBtn.getAttribute('data-lang') || 'javascript';
    if (code) {
      runnerCode.value = code;
      runnerLanguage.value = lang;
      showRunner.value = true;
    }
  }
};
</script>

<template>
  <div>
    <div class="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed prose-p:my-1.5 prose-p:leading-relaxed prose-headings:font-bold prose-headings:my-2 prose-h1:text-lg prose-h2:text-base prose-h3:text-sm prose-ul:my-1 prose-ul:list-disc prose-ul:pl-4 prose-ol:my-1 prose-ol:list-decimal prose-ol:pl-4 prose-li:my-0.5 prose-pre:my-2 prose-pre:p-0 prose-pre:bg-transparent prose-pre:rounded-lg prose-code:px-1 prose-code:py-0.5 prose-code:bg-slate-100 dark:prose-code:bg-gray-700 prose-code:rounded prose-code:text-pink-500 dark:prose-code:text-pink-400 prose-code:font-mono prose-code:text-xs prose-code:before:content-[''] prose-code:after:content-[''] prose-strong:font-bold prose-strong:text-slate-900 dark:prose-strong:text-white prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline prose-table:my-2 prose-table:w-full prose-table:text-left prose-table:border-collapse prose-th:p-2 prose-th:border prose-th:border-slate-200 dark:prose-th:border-gray-700 prose-th:bg-slate-50 dark:prose-th:bg-gray-800 prose-td:p-2 prose-td:border prose-td:border-slate-200 dark:prose-td:border-gray-700" v-html="renderedContent" @click="handleClick"></div>
    <CodeRunner
      v-if="showRunner"
      :code="runnerCode"
      :language="runnerLanguage"
      @close="showRunner = false"
    />
  </div>
</template>
