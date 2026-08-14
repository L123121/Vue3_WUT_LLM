import { describe, it, expect, beforeEach } from 'vitest';
import { useMarkdownRenderer } from '../composables/useMarkdownRenderer.js';

/**
 * Markdown 渲染缓存命中率 —— 模拟典型聊天场景实测
 *
 * 说明：统计口径为主线程渲染路径（renderMarkdownMain）。
 * 流式 chunk 每次内容都不同，天然 miss（缓存不背锅）；
 * 缓存的价值在"同一内容重复渲染不重算"（历史回看、虚拟滚动 remount、响应式重触发）。
 *
 * 场景A（单会话流式为主，不同消息不同内容）：
 *   4 条不同回答 × (20 个递增 chunk 流式 + 完成后完整内容再渲染 5 次)
 *   预期：miss=80（20 chunk × 4），hit=20（5 × 4），原始命中率 20%
 *   但重复渲染命中率 = 20/20 = 100%（流式结束后所有重渲染全部命中）
 *
 * 场景B（历史回看/虚拟滚动 remount，不同消息）：
 *   5 条不同消息 × 相同内容渲染 20 次（scroll 离开再回来会 remount 重渲染）
 *   预期：miss=5，hit=95，命中率 95%
 *
 * 场景C（同一内容反复出现，如相同回复/再次进入会话）：
 *   同一完整内容连续渲染 100 次
 *   预期：miss=1，hit=99，命中率 99%
 */
describe('Markdown 缓存命中率（模拟典型场景实测）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // idx 用于生成内容不同的消息；withIdx=false 返回完全相同的字符串
  const buildAssistantReply = (idx = 0) =>
    [
      `# 武理校园卡使用指南 ${idx}`,
      '',
      '**校园卡**是校内一卡通，支持食堂、图书馆、校医院等场景。',
      '',
      '1. 食堂：刷卡或扫码支付，每日限额 50 元',
      '2. 图书馆：刷卡入馆，借阅图书需要先在自助机激活',
      '3. 补办：南湖校区事务大厅 1 号窗口，工本费 15 元',
      '',
      '```js',
      'const card = new CampusCard();',
      'card.recharge(100);',
      '```',
      '',
      '> 提示：挂失请拨 12345 或登录企业微信办理。',
    ].join('\n');

  const measure = (renderFn, renders) => {
    renders.forEach((content) => renderFn(content));
    const stats = JSON.parse(localStorage.getItem('markdown_cache_stats') || '{"hits":0,"misses":0}');
    const total = stats.hits + stats.misses;
    const rate = total > 0 ? ((stats.hits / total) * 100).toFixed(1) : '0';
    const unique = new Set(renders).size;
    const repeat = renders.length - unique; // 可能命中的重复渲染次数
    const repeatHitRate = repeat > 0 ? ((stats.hits / repeat) * 100).toFixed(1) : 'N/A';
    console.log(
      `[SIM] 渲染 ${renders.length} 次（唯一内容 ${unique}）→ hit=${stats.hits} miss=${stats.misses} ` +
        `原始命中率=${rate}% 重复渲染命中率=${repeatHitRate}%`
    );
    return stats;
  };

  it('场景A：流式为主（4 条不同回答，各 20 个递增 chunk + 完成后渲染 5 次）', () => {
    const { renderMarkdownMain } = useMarkdownRenderer();
    const renders = [];

    for (let msg = 0; msg < 4; msg += 1) {
      const full = buildAssistantReply(msg);
      // 流式：内容逐步增长，每次都是不同字符串 → miss
      for (let i = 1; i <= 20; i += 1) {
        renders.push(full.slice(0, Math.floor((full.length * i) / 20)));
      }
      // 流式结束后：完整内容再渲染 5 次（组件重挂载/响应式触发）→ hit
      for (let r = 0; r < 5; r += 1) {
        renders.push(full);
      }
    }

    expect(renders.length).toBe(100);
    const stats = measure(renderMarkdownMain, renders);
    const unique = new Set(renders).size;
    const repeatCount = renders.length - unique; // 重复渲染次数
    // 首次渲染全部 miss；流式增量内容不同也 miss → miss >= 唯一内容数
    expect(stats.misses).toBeGreaterThanOrEqual(unique);
    expect(stats.hits + stats.misses).toBe(100);
    // 重复渲染应几乎全部命中（除缓存上限 50 淘汰个别早期内容）
    expect(stats.hits).toBeGreaterThanOrEqual(repeatCount * 0.9);
  });

  it('场景B：历史回看/虚拟滚动 remount（5 条不同消息 × 相同内容渲染 20 次）', () => {
    const { renderMarkdownMain } = useMarkdownRenderer();
    const renders = [];

    for (let msg = 0; msg < 5; msg += 1) {
      const content = buildAssistantReply(msg);
      for (let r = 0; r < 20; r += 1) {
        renders.push(content);
      }
    }

    expect(renders.length).toBe(100);
    const stats = measure(renderMarkdownMain, renders);
    expect(stats.misses).toBe(5);
    expect(stats.hits).toBe(95);
  });

  it('场景C：同一内容反复渲染（相同回复/再次进入会话）', () => {
    const { renderMarkdownMain } = useMarkdownRenderer();
    const renders = Array.from({ length: 100 }, () => buildAssistantReply(0));

    const stats = measure(renderMarkdownMain, renders);
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(99);
  });
});
