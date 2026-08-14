// 临时诊断脚本 v2：vectors.json 是数组结构
const fs = require('fs');

const raw = fs.readFileSync('/app/backend/data/vectors.json', 'utf-8');
const d = JSON.parse(raw);
console.log('top type:', Array.isArray(d) ? 'ARRAY' : typeof d, 'len:', Array.isArray(d) ? d.length : Object.keys(d).length);

const arr = Array.isArray(d) ? d : Object.values(d);
if (arr.length) {
  const s = arr[0];
  console.log('item0 keys:', Object.keys(s).join(', '));
  // 递归找向量字段
  function findVec(obj, depth = 0, path = '') {
    if (depth > 3 || !obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) {
      // 可能是稠密向量
      if (obj.length > 4 && typeof obj[0] === 'number') return { path, type: 'dense', len: obj.length };
      if (obj.length && typeof obj[0] === 'object') return findVec(obj[0], depth + 1, path + '[0]');
      return null;
    }
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (Array.isArray(v) && v.length > 4 && typeof v[0] === 'number') return { path: path + '.' + k, type: 'dense', len: v.length };
      if (v && typeof v === 'object' && !Array.isArray(v) && v !== null) {
        const r = findVec(v, depth + 1, path + '.' + k);
        if (r) return r;
      }
    }
    return null;
  }
  const fv = findVec(s);
  console.log('found vec:', fv ? JSON.stringify(fv) : 'NONE (可能纯稀疏/无向量)');
  if (fv) {
    const path = fv.path.replace(/^\./, '');
    const val = path.split('.').reduce((o, k) => o && o[k], s);
    console.log('dense sample:', val.slice(0, 5).map(x => +x.toFixed(4)).join(', '));
  }
  // 找稀疏对象
  function findSparse(obj, depth = 0, path = '') {
    if (depth > 3 || !obj || typeof obj !== 'object') return null;
    if (!Array.isArray(obj)) {
      const keys = Object.keys(obj);
      if (keys.length > 0 && keys.length < 5000 && keys.every(k => /^\d+$/.test(k)) && typeof obj[keys[0]] === 'number') {
        return { path, keys: keys.length, sample: keys.slice(0, 5).map(k => `${k}:${obj[k]}`).join(', ') };
      }
      for (const k of keys) {
        const r = findSparse(obj[k], depth + 1, path + '.' + k);
        if (r) return r;
      }
    }
    return null;
  }
  const fs2 = findSparse(s);
  console.log('sparse:', fs2 ? JSON.stringify(fs2) : 'NONE');
}
