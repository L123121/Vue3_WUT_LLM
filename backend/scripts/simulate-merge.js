const fs = require('fs');
const arr = JSON.parse(fs.readFileSync('data/vectors.json', 'utf8'));

// 复现 _mergeShortSentences 逻辑
function mergeShortSentences(sentences, targetMinLen = 25) {
  if (sentences.length <= 1) return sentences;
  const merged = [];
  let buffer = '';
  for (const s of sentences) {
    buffer = buffer ? buffer + s : s;
    if (buffer.length >= targetMinLen) { merged.push(buffer); buffer = ''; }
  }
  if (buffer.length > 0) {
    if (merged.length > 0 && buffer.length < 10) merged[merged.length - 1] += buffer;
    else merged.push(buffer);
  }
  return merged;
}

// 复现 _splitSentences（含合并）
function splitSentences(paragraph, targetMinLen = 25) {
  const _protected = paragraph.replace(/^([- ]*[A-D])\.\s/gm, '$1<DOT>');
  const parts = _protected.split(/(?<=[。！？.!?\n])\s*/);
  const sentences = parts.map(s => s.trim().replace(/<DOT>/g, '.')).filter(s => s.length > 0);
  if (sentences.length <= 1) return sentences;
  return mergeShortSentences(sentences, targetMinLen);
}

// 按 parentId 分组，模拟"同一段落内合并"
const byParent = new Map();
for (const item of arr) {
  const pid = item.metadata?.parentId;
  if (!pid) continue;
  if (!byParent.has(pid)) byParent.set(pid, { parentText: item.metadata?.parentText || '', sentences: [] });
  byParent.get(pid).sentences.push(item.document || '');
}

let totalBefore = 0, totalAfter = 0;
const afterLengths = [];
const examples = [];

for (const [pid, { parentText, sentences }] of byParent) {
  totalBefore += sentences.length;
  const merged = splitSentences(parentText);
  totalAfter += merged.length;
  for (const m of merged) afterLengths.push(m.length);

  // 挑几个有变化的做示例
  if (examples.length < 5 && sentences.length >= 3 && merged.length < sentences.length) {
    examples.push({ pid, before: sentences, after: merged });
  }
}

const a = afterLengths.sort((x, y) => x - y);
const sum = a.reduce((s, v) => s + v, 0);
const pct = (p) => a[Math.floor(a.length * p)];

console.log('===== 合并效果（按段落模拟） =====');
console.log('合并前句子数:', totalBefore);
console.log('合并后 chunk 数:', totalAfter);
console.log('减少:', totalBefore - totalAfter, '(' + (100 * (1 - totalAfter / totalBefore)).toFixed(1) + '%)');
console.log('\n--- 合并后长度分布 ---');
console.log('平均字数:', (sum / a.length).toFixed(1));
console.log('中位数:', pct(0.5));
console.log('P10 / P25 / P75 / P90:', pct(0.1), '/', pct(0.25), '/', pct(0.75), '/', pct(0.9));
console.log('最小 / 最大:', a[0], '/', a[a.length - 1]);

const tooShort = a.filter(x => x < 10).length;
const short = a.filter(x => x >= 10 && x < 30).length;
const medium = a.filter(x => x >= 30 && x < 100).length;
const long = a.filter(x => x >= 100).length;
console.log('\n< 10 字:', tooShort, '(' + (100 * tooShort / a.length).toFixed(1) + '%)');
console.log('10-30 字:', short, '(' + (100 * short / a.length).toFixed(1) + '%)');
console.log('30-100 字:', medium, '(' + (100 * medium / a.length).toFixed(1) + '%)');
console.log('>= 100 字:', long, '(' + (100 * long / a.length).toFixed(1) + '%)');

console.log('\n===== 合并示例 =====');
examples.forEach((ex, i) => {
  console.log(`\n--- 示例 ${i + 1} (${ex.pid}) ---`);
  console.log('合并前 (' + ex.before.length + ' 条):');
  ex.before.forEach((s, j) => console.log(`  ${j + 1}. [${s.length}字] ${JSON.stringify(s)}`));
  console.log('合并后 (' + ex.after.length + ' 条):');
  ex.after.forEach((s, j) => console.log(`  ${j + 1}. [${s.length}字] ${JSON.stringify(s).slice(0, 100)}`));
});
