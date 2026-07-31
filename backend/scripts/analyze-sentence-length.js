const fs = require('fs');
const file = 'data/vectors.json';
const arr = JSON.parse(fs.readFileSync(file, 'utf8'));

const stats = { total: 0, lengths: [], tooShort: 0, short: 0, medium: 0, long: 0 };
const samples = { tooShort: [], short: [], long: [] };

for (const item of arr) {
  const text = item.document || '';
  const len = text.length;
  stats.total++;
  stats.lengths.push(len);
  if (len < 10) {
    stats.tooShort++;
    if (samples.tooShort.length < 10) samples.tooShort.push(text);
  } else if (len < 30) {
    stats.short++;
    if (samples.short.length < 5) samples.short.push(text);
  } else if (len < 100) {
    stats.medium++;
  } else {
    stats.long++;
    if (samples.long.length < 3) samples.long.push(text);
  }
}

const a = stats.lengths.sort((x, y) => x - y);
const sum = a.reduce((s, v) => s + v, 0);
const pct = (p) => a[Math.floor(a.length * p)];

console.log('总句子数:', stats.total);
console.log('平均字数:', (sum / a.length).toFixed(1));
console.log('中位数:', pct(0.5));
console.log('P10 / P25 / P75 / P90:', pct(0.1), '/', pct(0.25), '/', pct(0.75), '/', pct(0.9));
console.log('最小 / 最大:', a[0], '/', a[a.length - 1]);
console.log('\n--- 按长度分布 ---');
console.log('< 10 字 (过碎):', stats.tooShort, '(' + (100 * stats.tooShort / stats.total).toFixed(1) + '%)');
console.log('10-30 字:', stats.short, '(' + (100 * stats.short / stats.total).toFixed(1) + '%)');
console.log('30-100 字:', stats.medium, '(' + (100 * stats.medium / stats.total).toFixed(1) + '%)');
console.log('>= 100 字:', stats.long, '(' + (100 * stats.long / stats.total).toFixed(1) + '%)');

console.log('\n--- <10 字样本 ---');
samples.tooShort.forEach((s, i) => console.log(`  ${i + 1}. [${s.length}字] ${JSON.stringify(s)}`));
console.log('\n--- 10-30 字样本 ---');
samples.short.forEach((s, i) => console.log(`  ${i + 1}. [${s.length}字] ${JSON.stringify(s)}`));
console.log('\n--- >=100 字样本 ---');
samples.long.forEach((s, i) => console.log(`  ${i + 1}. [${s.length}字] ${JSON.stringify(s).slice(0, 150)}...`));
