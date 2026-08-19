import { ref, onUnmounted } from 'vue';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import { useCodeHighlighter } from './useCodeHighlighter.js';
import { useMarkdownWorker } from './useMarkdownWorker.js';
import { ALLOWED_TAGS, ALLOWED_ATTR, completeMarkdown, normalizeBlockSyntax, createLinkSecurityRule } from '../utils/markdownConfig.js';

/**
 * Markdown 渲染 composable
 * 提供完整的 Markdown 渲染、安全清理和流式更新功能
 */
export function useMarkdownRenderer() {
  const { highlightCode, getLanguageLabel, isExecutableLanguage, escapeHtml, highlightVersion } = useCodeHighlighter();
  const { renderInWorker } = useMarkdownWorker();

  // Worker 阈值：内容超过此长度时使用 Worker
  const WORKER_THRESHOLD = 2000;
  const RENDER_THROTTLE_MS = 150;

  let throttleTimer = null;
  const renderedContent = ref('');
  const lastRenderedAt = ref('');
  const isLoadingWorker = ref(false);

  // Markdown 补全逻辑 — 使用 md.parse() Token 流检测未闭合语法
  // 注意：只补全代码围栏（```），因为不闭合会影响后续内容渲染。
  // 加粗/斜体等内联语法即使不闭合，markdown-it 也能正常渲染，追加关闭标记反而产生多余符号。

  // 创建代码高亮函数
  const highlightCodeBlock = (str, lang) => {
    const normalizedLang = (lang || '').trim().toLowerCase();
    const mappedLang = getLanguageLabel(normalizedLang);

    if (mappedLang && mappedLang !== 'text') {
      const highlighted = highlightCode(str, mappedLang);
      return {
        highlighted,
        language: mappedLang,
        isExecutable: isExecutableLanguage(normalizedLang),
      };
    }

    return {
      highlighted: escapeHtml(str),
      language: 'text',
      isExecutable: false,
    };
  };

  // 配置 MarkdownIt
  const md = new MarkdownIt({
    html: false,
    xhtmlOut: true,
    breaks: true,
    linkify: true,
    typographer: true,
    highlight: (str, lang) => {
      const result = highlightCodeBlock(str, lang);
      // 返回原始高亮结果，CodeBlock 组件会处理包装
      return result.highlighted;
    },
  });

  createLinkSecurityRule(md);

  // 渲染结果缓存，避免重复解析相同内容（FIFO，上限淘汰）
  const renderCache = new Map();
  const MAX_RENDER_CACHE = 50;

  // 缓存命中率统计（简历/性能数据用）：hit/miss 计数 + localStorage 持久化 + 定期日志
  // 口径：主线程渲染路径（renderMarkdownMain），Worker 大内容路径不走此缓存
  const CACHE_STATS_KEY = 'markdown_cache_stats';
  let cacheHits = 0;
  let cacheMisses = 0;
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_STATS_KEY) || '{}');
    cacheHits = saved.hits || 0;
    cacheMisses = saved.misses || 0;
  } catch { /* localStorage 不可用（隐私模式/SSR）时忽略 */ }

  const persistCacheStats = () => {
    try {
      localStorage.setItem(CACHE_STATS_KEY, JSON.stringify({ hits: cacheHits, misses: cacheMisses }));
    } catch {}
  };

  const recordCacheAccess = (hit) => {
    if (hit) cacheHits += 1;
    else cacheMisses += 1;
    if ((cacheHits + cacheMisses) % 50 === 0) persistCacheStats();
  };

  // 主线程渲染
  const renderMarkdownMain = (content) => {
    if (!content || content.trim() === '') return '';
    // 命中缓存则直接返回
    if (renderCache.has(content)) {
      recordCacheAccess(true);
      return renderCache.get(content);
    }
    try {
      const completed = normalizeBlockSyntax(completeMarkdown(content));
      const raw = md.render(completed);
      const html = DOMPurify.sanitize(raw, { ALLOWED_TAGS, ALLOWED_ATTR });
      // 缓存结果，超过上限时淘汰最老的
      if (renderCache.size >= MAX_RENDER_CACHE) {
        const firstKey = renderCache.keys().next().value;
        renderCache.delete(firstKey);
      }
      renderCache.set(content, html);
      recordCacheAccess(false);
      return html;
    } catch {
      return content;
    }
  };

  // 更新渲染内容
  const updateRender = async (content) => {
    // 使用 Web Worker 处理大内容；Worker 不可用/超时/onerror 时 reject，走主线程兜底
    if (content && content.length > WORKER_THRESHOLD) {
      isLoadingWorker.value = true;
      try {
        const html = await renderInWorker(content);
        if (html) {
          renderedContent.value = html;
          lastRenderedAt.value = content;
        } else {
          // 空内容（合法渲染输出）— 不算失败，正常收尾
          renderedContent.value = html;
          lastRenderedAt.value = content;
        }
      } catch {
        // Worker 失败/超时/不可用 → 主线程回退（原有行为）
        renderedContent.value = renderMarkdownMain(content);
        lastRenderedAt.value = content;
      }
      isLoadingWorker.value = false;
    } else {
      renderedContent.value = renderMarkdownMain(content);
      lastRenderedAt.value = content;
    }
  };

  // 带节流的渲染更新
  const throttledUpdate = (content) => {
    if (throttleTimer) return;
    throttleTimer = setTimeout(() => {
      updateRender(content);
      throttleTimer = null;
    }, RENDER_THROTTLE_MS);
  };

  // 检查内容是否过时
  const isContentStale = (content) => content !== lastRenderedAt.value;

  // 清理
  onUnmounted(() => {
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
  });

  return {
    renderedContent,
    isLoadingWorker,
    highlightVersion,
    renderMarkdownMain,
    updateRender,
    throttledUpdate,
    isContentStale,
    completeMarkdown,
    highlightCodeBlock,
  };
}
