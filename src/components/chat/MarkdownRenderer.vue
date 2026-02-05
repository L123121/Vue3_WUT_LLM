<script setup lang="ts">
import { computed } from 'vue';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css';

const props = defineProps<{
  content: string;
}>();

const emit = defineEmits<{
  (e: 'copyCode', code: string): void;
}>();

// 辅助函数：HTML 转义
const escapeHtml = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// 代码高亮函数
const highlightCode = (str: string, lang: string): string => {
  if (lang && hljs.getLanguage(lang)) {
    try {
      const highlighted = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
      const encodedCode = encodeURIComponent(str);
      return `<div class="code-block-wrapper my-3 rounded-lg overflow-hidden bg-[#282c34] text-white shadow-md border border-slate-700">
        <div class="flex items-center justify-between px-3 py-1.5 bg-[#21252b] text-xs text-gray-400 select-none border-b border-slate-700">
          <span class="font-mono font-medium opacity-80">${lang}</span>
          <button 
            class="copy-code-btn flex items-center gap-1.5 hover:text-white transition-all duration-200 cursor-pointer px-2 py-0.5 rounded hover:bg-white/10"
            data-code="${encodedCode}"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            <span class="copy-text">复制</span>
          </button>
        </div>
        <pre class="!m-0 !p-4 overflow-x-auto bg-[#282c34] font-mono text-sm leading-normal"><code class="hljs language-${lang}">${highlighted}</code></pre>
      </div>`;
    } catch {
      // fallback below
    }
  }
  
  // 无语言或未知语言
  const encodedCode = encodeURIComponent(str);
  return `<div class="code-block-wrapper my-3 rounded-lg overflow-hidden bg-[#282c34] text-white shadow-md border border-slate-700">
    <div class="flex items-center justify-between px-3 py-1.5 bg-[#21252b] text-xs text-gray-400 select-none border-b border-slate-700">
      <span class="font-mono font-medium opacity-80">text</span>
      <button 
        class="copy-code-btn flex items-center gap-1.5 hover:text-white transition-all duration-200 cursor-pointer px-2 py-0.5 rounded hover:bg-white/10"
        data-code="${encodedCode}"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
        <span class="copy-text">复制</span>
      </button>
    </div>
    <pre class="!m-0 !p-4 overflow-x-auto bg-[#282c34] font-mono text-sm leading-normal"><code class="hljs">${escapeHtml(str)}</code></pre>
  </div>`;
};

// 配置并创建 markdown-it 实例
const md = new MarkdownIt({
  html: false,
  xhtmlOut: true,
  breaks: true,
  linkify: true,
  typographer: true,
  highlight: highlightCode
});

// 渲染 Markdown
const renderedContent = computed(() => {
  if (!props.content || props.content.trim() === '') {
    return '';
  }
  try {
    return md.render(props.content);
  } catch (e) {
    console.error('Markdown rendering error:', e);
    return props.content;
  }
});

// 处理代码复制点击事件
const handleClick = (event: MouseEvent) => {
  const target = (event.target as HTMLElement).closest('.copy-code-btn');
  if (target) {
    const btn = target as HTMLElement;
    const code = decodeURIComponent(btn.getAttribute('data-code') || '');
    if (code) {
      navigator.clipboard.writeText(code).then(() => {
        emit('copyCode', code);
        
        // 按钮反馈
        const textSpan = btn.querySelector('.copy-text');
        if (textSpan) {
          const originalText = textSpan.innerHTML;
          textSpan.innerHTML = '<span class="text-green-400">已复制</span>';
          
          setTimeout(() => {
            textSpan.innerHTML = originalText;
          }, 2000);
        }
      });
    }
  }
};
</script>

<template>
  <div 
    class="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed
      prose-p:my-1.5 prose-p:leading-relaxed
      prose-headings:font-bold prose-headings:my-2 prose-h1:text-lg prose-h2:text-base prose-h3:text-sm
      prose-ul:my-1 prose-ul:list-disc prose-ul:pl-4
      prose-ol:my-1 prose-ol:list-decimal prose-ol:pl-4
      prose-li:my-0.5
      prose-pre:my-2 prose-pre:p-0 prose-pre:bg-transparent prose-pre:rounded-lg
      prose-code:px-1 prose-code:py-0.5 prose-code:bg-slate-100 dark:prose-code:bg-gray-700 prose-code:rounded prose-code:text-pink-500 dark:prose-code:text-pink-400 prose-code:font-mono prose-code:text-xs prose-code:before:content-[''] prose-code:after:content-['']
      prose-strong:font-bold prose-strong:text-slate-900 dark:prose-strong:text-white
      prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
      prose-table:my-2 prose-table:w-full prose-table:text-left prose-table:border-collapse
      prose-th:p-2 prose-th:border prose-th:border-slate-200 dark:prose-th:border-gray-700 prose-th:bg-slate-50 dark:prose-th:bg-gray-800
      prose-td:p-2 prose-td:border prose-td:border-slate-200 dark:prose-td:border-gray-700"
    v-html="renderedContent"
    @click="handleClick"
  ></div>
</template>
