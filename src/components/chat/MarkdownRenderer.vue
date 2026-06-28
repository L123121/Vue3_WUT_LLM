<script setup>
import { ref, watch, onUnmounted } from 'vue';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import DOMPurify from 'dompurify';
import { useMarkdownWorker } from '../../composables/useMarkdownWorker.js';
import { useCodeHighlighter } from '../../composables/useCodeHighlighter.js';
import { ALLOWED_TAGS, ALLOWED_ATTR, completeMarkdown, escapeHtml, createLinkSecurityRule } from '../../utils/markdownConfig.js';
import CodeRunner from './CodeRunner.vue';
import 'highlight.js/styles/atom-one-dark.css';

// 仅当代码围栏 (```) 未闭合时补全，内联语法不处理（markdown-it 自能处理）

// Worker for large content (>2000 chars)
const WORKER_THRESHOLD = 2000;
const { renderInWorker } = useMarkdownWorker();
const { highlightCode, getLanguageLabel, isExecutableLanguage, highlightVersion, ensureLanguage } = useCodeHighlighter();

const props = defineProps({ content: { type: String, default: '' } });
const emit = defineEmits(['copyCode']);

const showRunner = ref(false);
const runnerCode = ref('');
const runnerLanguage = ref('javascript');

// 代码块渲染 - 使用 CodeBlock 组件的 HTML 结构
const renderCodeBlock = (code, language, label, rawCode) => {
  const encodedCode = encodeURIComponent(code);
  const encodedRawCode = encodeURIComponent(rawCode || code);
  const isExecutable = isExecutableLanguage(label);
  const runButton = isExecutable
    ? `<button class="run-code-btn flex items-center gap-1.5 hover:text-green-400 transition-all duration-200 cursor-pointer px-2 py-0.5 rounded hover:bg-white/10" data-code="${encodedRawCode}" data-lang="${label}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>运行</span></button>`
    : '';
  return `<div class="code-block-wrapper my-3 rounded-lg overflow-hidden bg-[#282c34] text-white shadow-md border border-slate-700"><div class="flex items-center justify-between px-3 py-1.5 bg-[#21252b] text-xs text-gray-400 select-none border-b border-slate-700"><span class="font-mono font-medium opacity-80">${label}</span><div class="flex items-center gap-2">${runButton}<button class="copy-code-btn flex items-center gap-1.5 text-gray-300 hover:text-white transition-all duration-200 cursor-pointer px-2 py-0.5 rounded bg-slate-600/80 hover:bg-slate-500" data-code="${encodedCode}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><span class="copy-text">复制</span></button></div></div><pre class="!m-0 !p-4 overflow-x-auto bg-[#282c34] font-mono text-sm leading-normal"><code class="hljs ${language}">${code}</code></pre></div>`;
};

// 代码高亮包装
const highlightCodeBlock = (str, lang) => {
  const normalizedLang = (lang || '').trim().toLowerCase();
  const mappedLang = getLanguageLabel(normalizedLang);

  if (mappedLang && hljs.getLanguage(mappedLang)) {
    try {
      return renderCodeBlock(
        hljs.highlight(str, { language: mappedLang, ignoreIllegals: true }).value,
        `language-${mappedLang}`, mappedLang, str
      );
    } catch { /* fall through */ }
  }

  if (mappedLang) {
    ensureLanguage(mappedLang).then(() => { highlightVersion.value++; });
  }

  try {
    const autoResult = hljs.highlightAuto(str);
    if (autoResult?.value) {
      return renderCodeBlock(autoResult.value, `language-${autoResult.language || 'text'}`, autoResult.language || 'text', str);
    }
  } catch { /* fall through */ }

  return renderCodeBlock(escapeHtml(str), '', normalizedLang || 'text', str);
};

const md = new MarkdownIt({
  html: false, xhtmlOut: true, breaks: true, linkify: true, typographer: true, highlight: highlightCodeBlock,
});

createLinkSecurityRule(md);

// --- Rendering logic with Worker offloading ---

const renderMarkdownMain = (content) => {
  if (!content || content.trim() === '') return '';
  try {
    const completed = completeMarkdown(content);
    const raw = md.render(completed);
    return DOMPurify.sanitize(raw, { ALLOWED_TAGS, ALLOWED_ATTR });
  } catch (e) {
    console.error('[MarkdownRenderer] 渲染失败:', e);
    return content;
  }
};

const RENDER_THROTTLE_MS = 150;
let throttleTimer = null;

const renderedContent = ref('');
const lastRenderedAt = ref('');
const isLoadingWorker = ref(false);

// Initial render
renderedContent.value = renderMarkdownMain(props.content);
lastRenderedAt.value = props.content;

const updateRender = async () => {
  const content = props.content;

  // Use Web Worker for large content
  if (content && content.length > WORKER_THRESHOLD) {
    isLoadingWorker.value = true;
    const html = await renderInWorker(content);
    if (html) {
      renderedContent.value = html;
      lastRenderedAt.value = content;
    } else {
      // Worker fallback
      renderedContent.value = renderMarkdownMain(content);
      lastRenderedAt.value = content;
    }
    isLoadingWorker.value = false;
  } else {
    renderedContent.value = renderMarkdownMain(content);
    lastRenderedAt.value = content;
  }
};

watch(
  () => [props.content, highlightVersion.value],
  () => {
    if (throttleTimer) return;
    throttleTimer = setTimeout(() => {
      updateRender();
      throttleTimer = null;
    }, RENDER_THROTTLE_MS);
  }
);

const isContentStale = () => props.content !== lastRenderedAt.value;

onUnmounted(() => {
  if (throttleTimer) {
    clearTimeout(throttleTimer);
    throttleTimer = null;
  }
});

const handleClick = (event) => {
  const copyBtn = event.target.closest('.copy-code-btn');
  if (copyBtn) {
    const code = decodeURIComponent(copyBtn.getAttribute('data-code') || '');
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      emit('copyCode', code);
      const textSpan = copyBtn.querySelector('.copy-text');
      if (textSpan) {
        const orig = textSpan.innerHTML;
        textSpan.innerHTML = '<span class="text-green-400">已复制</span>';
        setTimeout(() => { textSpan.innerHTML = orig; }, 2000);
      }
    });
    return;
  }

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
    <!-- Stale: show last rendered + pulsing cursor -->
    <div v-if="isContentStale() && renderedContent" class="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed">
      <div v-html="renderedContent" @click="handleClick"></div>
      <span class="inline-block w-0.5 h-4 bg-blue-500 animate-pulse ml-0.5 align-middle"></span>
    </div>
    <!-- Worker loading indicator for large content -->
    <div v-else-if="isLoadingWorker" class="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed">
      <div class="flex items-center gap-2 text-slate-400 dark:text-gray-500 text-sm py-2">
        <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce"></span>
        <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style="animation-delay:0.15s"></span>
        <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style="animation-delay:0.3s"></span>
        <span class="ml-1">渲染中...</span>
      </div>
    </div>
    <!-- Normal rendered content -->
    <div v-else class="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed prose-p:my-1.5 prose-p:leading-relaxed prose-headings:font-bold prose-headings:my-2 prose-h1:text-lg prose-h2:text-base prose-h3:text-sm prose-ul:my-1 prose-ul:list-disc prose-ul:pl-4 prose-ol:my-1 prose-ol:list-decimal prose-ol:pl-4 prose-li:my-0.5 prose-pre:my-2 prose-pre:p-0 prose-pre:bg-transparent prose-pre:rounded-lg prose-code:px-1 prose-code:py-0.5 prose-code:bg-slate-100 dark:prose-code:bg-gray-700 prose-code:rounded prose-code:text-pink-500 dark:prose-code:text-pink-400 prose-code:font-mono prose-code:text-xs prose-code:before:content-[''] prose-code:after:content-[''] prose-strong:font-bold prose-strong:text-slate-900 dark:prose-strong:text-white prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline prose-table:my-2 prose-table:w-full prose-table:text-left prose-table:border-collapse prose-th:p-2 prose-th:border prose-th:border-slate-200 dark:prose-th:border-gray-700 prose-th:bg-slate-50 dark:prose-th:bg-gray-800 prose-td:p-2 prose-td:border prose-td:border-slate-200 dark:prose-td:border-gray-700" v-html="renderedContent" @click="handleClick"></div>
    <CodeRunner v-if="showRunner" :code="runnerCode" :language="runnerLanguage" @close="showRunner = false" />
  </div>
</template>
