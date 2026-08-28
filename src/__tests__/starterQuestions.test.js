import { describe, it, expect } from 'vitest';
import { buildStarterQuestions } from '../utils/starterQuestions.js';

describe('buildStarterQuestions 空会话快捷提问生成', () => {
  const documents = [
    { id: '1', title: '武汉理工大学交通出行指南', category: '学校概况' },
    { id: '2', title: '图书馆使用指南', category: '学校概况' },
    { id: '3', title: '《操作系统》期末复习笔记', category: '课程复习' },
    { id: '4', title: '保研经验分享', category: '升学就业' },
    { id: '5', title: 'ab', category: '学校概况' }, // 过短标题过滤
  ];

  it('按类别打散取多样文档，句式按条数轮换', () => {
    const items = buildStarterQuestions(documents, 4);
    expect(items.length).toBe(4);
    // 第一轮每类取一篇：前 3 条来自 3 个不同类别，第二轮补齐第 4 条
    expect(items[0].text).toBe('《武汉理工大学交通出行指南》讲了什么？');
    expect(items[1].text).toBe('《操作系统》期末复习笔记的重点有哪些？');
    expect(items[2].text).toBe('帮我总结一下保研经验分享');
    expect(items[3].text).toContain('图书馆');
    // 句式不重复
    const styles = new Set(items.map((i) => i.text.slice(0, 2)));
    expect(styles.size).toBeGreaterThan(1);
  });

  it('超长标题截断到 18 字符以内（含省略号）', () => {
    const items = buildStarterQuestions([{ title: '这是一个特别特别特别特别特别特别长的文档标题呢', category: 'x' }], 4);
    expect(items[0].text).toContain('…');
    expect(items[0].text.length).toBeLessThanOrEqual(28);
  });

  it('空/无效输入返回空数组', () => {
    expect(buildStarterQuestions([], 4)).toEqual([]);
    expect(buildStarterQuestions(null, 4)).toEqual([]);
  });

  it('单类别多篇文档也能取满多轮', () => {
    const items = buildStarterQuestions(
      [
        { title: '文档甲乙丙丁', category: 'same' },
        { title: '文档戊己庚辛', category: 'same' },
        { title: '文档壬癸子丑', category: 'same' },
        { title: '文档寅卯辰巳', category: 'same' },
      ],
      4,
    );
    expect(items.length).toBe(4);
  });
});
