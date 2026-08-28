"use strict";

const config = require('../config');
const { QueryCache } = require('../utils/query-cache');

// query rewrite 缓存（模块级单例）：同 query + 最近 6 条历史窗口直接命中
const rewriteCache = new QueryCache(
  config.rag.rewriteCacheMaxEntries || 500,
  config.rag.cacheTtlMs || 300000,
);

/**
 * 检测是否需要改写：有历史 + 含代词/省略
 */
function shouldRewriteQuery(query, history) {
  if (!history || history.length === 0) return false;
  const lastUserMsg = history.filter(h => h.role === 'user').slice(-1)[0];
  if (!lastUserMsg) return false;

  const q = String(query || '').trim();
  // 短 query（< 5 字）大概率是省略
  if (q.length < 5) return true;
  // 含代词/指代
  if (/^(这个|那个|它|它们|他|她|他们|她们|那|那些|这些|这|那|其|该|此)/.test(q)) return true;
  if (/\b(这个|那个|它|它们|他|她|他们|她们|那|那些|这些)\b/.test(q)) return true;
  // 省略式（"那费用呢？""条件呢？"）
  if (/^(那|那.*呢|然后|还有|那.*吗|费用|条件|流程|要求|时间|地点|原因|结果|影响|区别|结果)$/.test(q)) return true;
  if (/^.+呢$/.test(q) && q.length < 8) return true;
  return false;
}

/** 将消息列表 hash 为短字符串，用于 rewrite 缓存 key */
function hashHistory(messages) {
  if (!messages || !messages.length) return 'empty';
  return messages.map(m => `${m.role}:${(m.content || '').slice(0, 100)}`).join('|');
}

/**
 * 用 LLM 改写 query
 * 将带指代/省略的问题补全为独立的自包含问题
 * 处理三个核心难点：
 *   1. 实体消歧：多个候选实体时正确选择
 *   2. 跨轮指代：支持 3 轮内的长跨度指代
 *   3. 语义指代："这个"可能指整句话的意思而非单个名词
 *
 * @param {string} query - 用户最新问题
 * @param {Array} history - 历史消息
 * @param {Object} aiService - 提供 getCompletion 的 AI 服务实例
 * @returns {Promise<string|null>} 改写后的 query，失败返回 null
 */
async function rewriteQuery(query, history, aiService) {
  if (!history || history.length === 0) return null;

  // 缓存拦截：同 query + 最近 6 条历史窗口时直接返回
  if (config.rag.cacheEnabled) {
    const historyHash = hashHistory(history.slice(-6));
    const cacheKey = `${String(query || '').trim().toLowerCase()}|${historyHash}`;
    const cached = rewriteCache.get(cacheKey);
    if (cached !== undefined) return cached;
  }

  // 取最近 3 轮（6 条消息），在 token 成本和跨度覆盖之间折中
  // 3 轮覆盖绝大多数指代场景，超过 3 轮的指代即使人工也难判断
  const recentHistory = history.slice(-6);
  const historyText = recentHistory
    .map(h => `${h.role === 'user' ? '用户' : '助手'}: ${h.content}`)
    .join('\n');

  const prompt = `根据对话历史，将用户最新问题补全为独立的自包含问题。

注意：
1. 如果"这个""那个""它"可能指代多个事物，根据上下文选出最可能的一个
2. 如果"这个"指代前文一整句话的意思，把整句话的要义概括进问题
3. 只输出补全后的问题，不要多余文字
4. 不要添加历史中没有的信息

对话历史：
${historyText}

用户最新问题：${query}

补全后的问题：`;

  try {
    const result = await aiService.getCompletion(prompt, [], { timeout: 5000, retries: 1 });
    const rewritten = (result.content || '').trim().replace(/^["「『]|["」』]$/g, '');
    if (!rewritten || rewritten.length < 2) return null;
    // 防止改写后和原文一模一样（LLM 偷懒）
    if (rewritten === query.trim()) return null;

    // 缓存写入
    if (config.rag.cacheEnabled) {
      const historyHash = hashHistory(recentHistory);
      const cacheKey = `${String(query || '').trim().toLowerCase()}|${historyHash}`;
      rewriteCache.set(cacheKey, rewritten);
    }

    console.log(`[QueryRewrite] "${query}" → "${rewritten}"`);
    return rewritten;
  } catch (err) {
    console.warn(`[QueryRewrite] 改写失败: ${err.message}`);
    return null;
  }
}

module.exports = { shouldRewriteQuery, rewriteQuery, hashHistory };
