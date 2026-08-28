/**
 * 空会话快捷提问面板的问题生成
 *
 * 优先从知识库真实文档动态生成（按类别打散取多样文档），
 * 知识库为空 / 拉取失败时退回静态兜底问题，保证面板永远有内容。
 */

/**
 * 从知识库文档列表生成提问 chips
 * 句式按条数轮换，避免四张卡片全是同一句式
 * @param {Array} documents - 知识库文档（{ id, title, category }）
 * @param {number} [max=4] - 最多返回条数
 * @returns {Array<{ text: string, category: string }>}
 */

const QUESTION_TEMPLATES = [
  (title) => `《${title}》讲了什么？`,
  (title) => `${title}的重点有哪些？`,
  (title) => `帮我总结一下${title}`,
];

export function buildStarterQuestions(documents = [], max = 4) {
  if (!Array.isArray(documents) || documents.length === 0) return [];

  // 按类别分组（保持出现顺序），每轮从不同类别轮流取一篇，保证主题多样性
  const byCategory = new Map();
  for (const doc of documents) {
    const title = String(doc?.title || '').trim();
    if (!title || title.length < 4) continue;
    const category = String(doc?.category || 'general').trim() || 'general';
    if (!byCategory.has(category)) byCategory.set(category, []);
    if (byCategory.get(category).length < 5) byCategory.get(category).push(title);
  }

  const groups = [...byCategory.values()];
  const picked = [];
  let round = 0;
  while (picked.length < max && round < 5) {
    let addedThisRound = false;
    for (const titles of groups) {
      if (picked.length >= max) break;
      const title = titles[round];
      if (!title) continue;
      // 同一标题不重复；标题过长截断（保留完整语义的类别名优先）
      if (picked.some((p) => p.text.includes(title))) continue;
      const shortTitle = title.length > 18 ? `${title.slice(0, 17)}…` : title;
      const template = QUESTION_TEMPLATES[picked.length % QUESTION_TEMPLATES.length];
      picked.push({ text: template(shortTitle), category: '', sourceTitle: title });
      addedThisRound = true;
    }
    if (!addedThisRound) break;
    round++;
  }
  return picked;
}
