import { describe, it, expect } from 'vitest';
import { applyCitationBadges } from '../utils/citations.js';

const sources = [
  { title: '校园指南', snippet: '图书馆开放时间为早上 8 点' },
  { title: '教务FAQ', snippet: '' },
];

describe('applyCitationBadges', () => {
  it('【文档 N】渲染为徽章并带来源悬停提示', () => {
    const html = '<p>图书馆早上八点开门【文档 1】。</p>';
    const out = applyCitationBadges(html, sources);
    expect(out).toContain('class="citation" data-index="1"');
    expect(out).toContain('title="校园指南：图书馆开放时间为早上 8 点"');
    expect(out).toContain('>1</span>');
  });

  it('[N] 格式同样渲染（RAGFlow 风格容错）', () => {
    const out = applyCitationBadges('<p>校车每 15 分钟一班 [2]。</p>', sources);
    expect(out).toContain('data-index="2"');
  });

  it('markdown 链接 [1](url) 不误判为引用', () => {
    const raw = '<p>参考 <a href="https://x.y">文档</a></p><p>[1](https://x.y)</p>';
    const out = applyCitationBadges(raw, sources);
    // [1]( 后面是 ( → 不替换
    expect(out).toContain('[1](https://x.y)');
  });

  it('<code>/<pre> 内的 [1] 不替换', () => {
    const html = '<p>说明[1]</p><pre><code>arr[1] = 2;</code></pre>';
    const out = applyCitationBadges(html, sources);
    expect(out).toContain('data-index="1"');      // 正文替换
    expect(out).toContain('arr[1] = 2;');          // 代码原样保留
  });

  it('title 属性做 HTML 转义', () => {
    const evil = [{ title: '<script>x</script>', snippet: '"onclick="' }];
    const out = applyCitationBadges('<p>事实【文档 1】</p>', evil);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('无来源时提示点击查看；无匹配时原样返回', () => {
    expect(applyCitationBadges('<p>无引用文本</p>', sources)).toBe('<p>无引用文本</p>');
    const out = applyCitationBadges('<p>事实 [3]</p>', sources);
    expect(out).toContain('title="点击查看来源"');
  });
});
