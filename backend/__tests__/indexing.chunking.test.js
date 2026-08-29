import { describe, it, expect, vi, beforeEach } from 'vitest';

function getIndexingService() {
  delete require.cache[require.resolve('../src/services/indexing.service')];
  return require('../src/services/indexing.service').IndexingService;
}

function getRerankerService() {
  delete require.cache[require.resolve('../src/services/reranker.service')];
  return require('../src/services/reranker.service').RerankerService;
}

/**
 * 切片结构测试：frontmatter 剥离 + Markdown 标题章节合并
 * 背景：md 指南文件此前退化成逐行父段落，纯标题行单独成段后凭字面重叠
 * 抢占检索上下文，模型只能拿到"标题 + 元数据"作答。
 */
describe('IndexingService 切片结构', () => {
  let svc;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const IndexingService = getIndexingService();
    svc = new IndexingService({ addChunks: vi.fn() }, { embedBatch: vi.fn() });
  });

  it('剥离 YAML frontmatter，元数据不进入父段落', () => {
    const text = [
      '---',
      'created: 2026-08-17',
      'category: 专业课程',
      'tags: [推免, 保研]',
      '---',
      '',
      '# 推免保研准备与材料清单',
      '',
      '正文内容从这里开始，包含具体的材料说明。',
    ].join('\n');

    const paras = svc._splitParagraphs(text);
    const joined = paras.join('\n');

    expect(joined).not.toContain('created: 2026-08-17');
    expect(joined).not.toContain('tags: [推免, 保研]');
    expect(joined).toContain('正文内容从这里开始');
  });

  it('无 frontmatter 的文本原样保留', () => {
    const text = '第一段内容。\n\n第二段内容。';
    expect(svc._splitParagraphs(text).join('\n')).toContain('第一段内容');
  });

  it('Markdown 标题作为章节边界，标题与正文合并为同一父段落', () => {
    const text = [
      '# 推免保研准备与材料清单',
      '',
      '> 本文只提供准备方法，不替代学院当年实施细则。',
      '',
      '## 三、材料清单',
      '',
      '- 成绩单、成绩排名或绩点证明。',
      '- 在读证明、身份证明和学生证材料。',
      '- 中英文简历。',
      '',
      '## 四、面试准备框架',
      '',
      '每个项目至少准备项目背景、个人工作与技术选择。',
    ].join('\n\n');

    const paras = svc._splitParagraphs(text);

    // 不存在"纯标题"父段落：每个标题都和它的正文在同一父段落里
    for (const p of paras) {
      const isBareHeading = /^#{1,6}\s+\S/.test(p.trim()) && !p.split('\n').some(line => !/^#{1,6}\s/.test(line.trim()) && line.trim());
      expect(isBareHeading).toBe(false);
    }
    // 材料清单标题与它的列表内容在同一父段落
    const materialPara = paras.find(p => p.includes('## 三、材料清单'));
    expect(materialPara).toContain('成绩单、成绩排名或绩点证明');
    expect(materialPara).toContain('中英文简历');
  });

  it('中文序号标题（DOCX 转文本）合并行为保持不变', () => {
    const text = [
      '一、学校概况',
      '武汉理工大学由三校合并而成。',
      '二、校区分布',
      '学校现有多个校区。',
    ].join('\n\n');

    const paras = svc._splitParagraphs(text);
    expect(paras).toHaveLength(2);
    expect(paras[0]).toContain('一、学校概况');
    expect(paras[0]).toContain('三校合并');
    expect(paras[1]).toContain('二、校区分布');
  });
});

/**
 * fallback 排序降权：纯标题/超短候选不再压过含内容的段落
 */
describe('RerankerService._fallbackRank', () => {
  let svc;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const RerankerService = getRerankerService();
    svc = new RerankerService();
  });

  it('纯标题行降权后不再排第一', () => {
    const candidates = [
      { id: 'heading', text: '# 推免保研准备与材料清单', score: 0.9 },
      { id: 'content', text: '成绩单、在读证明、中英文简历、个人陈述、获奖证明与推荐信', score: 0.5 },
    ];

    const result = svc._fallbackRank(candidates, 2);
    expect(result[0].id).toBe('content');
    expect(result[0]._rerankScore).toBeCloseTo(0.5);
    // 标题候选被降权 0.3 倍但仍在列表内
    expect(result[1].id).toBe('heading');
    expect(result[1]._rerankScore).toBeCloseTo(0.27);
  });

  it('超短候选（<12 字）同样降权', () => {
    const candidates = [
      { id: 'tiny', text: '联系方式见官网', score: 0.9 },
      { id: 'content', text: '图书馆开放时间为工作日早上八点，周末上午九点，考试周顺延。', score: 0.6 },
    ];

    const result = svc._fallbackRank(candidates, 2);
    expect(result[0].id).toBe('content');
  });
});
