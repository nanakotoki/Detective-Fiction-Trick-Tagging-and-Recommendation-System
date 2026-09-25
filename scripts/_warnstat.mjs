// 一次性：按 check-data 的口径，把全部警告分类统计出来（它只打印前 40 条）
import { readFileSync, readdirSync } from 'node:fs';
import { TAG_MAP } from '../web/js/core/tags.js';

const counts = {};
const bump = (k) => (counts[k] = (counts[k] || 0) + 1);
const samples = {};

for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const arr = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  arr.forEach((b, i) => {
    const where = `${f}[${i}]`;
    if (/[^\x00-\x7F]/.test(f) || !/^batch-\d+-[\w-]+\.json$/.test(f)) bump('文件命名不规范');
    const tags = Array.isArray(b.tags) ? b.tags : [];
    const dupTags = tags.filter((t, x) => tags.indexOf(t) !== x);
    if (dupTags.length) bump('标签重复');
    const school = Array.isArray(b.school) ? b.school : [];
    const dupSchool = school.filter((t, x) => school.indexOf(t) !== x);
    if (dupSchool.length) bump('流派重复');
    const trickCount = tags.filter((t) => TAG_MAP[t]?.category === 'trick').length;
    if (trickCount === 0) {
      bump('无诡计类标签');
      samples['无诡计类标签'] = samples['无诡计类标签'] || `${where} 《${b.title}》`;
    }
    const len = String(b.safeSummary ?? '').replace(/\s/g, '').length;
    if (len < 30) {
      bump('无剧透简介过短');
      samples['无剧透简介过短'] = samples['无剧透简介过短'] || `${where} 《${b.title}》 ${len} 字`;
    }
    const alts = Array.isArray(b.alternateTitles) ? b.alternateTitles : [];
    if (new Set(alts).size !== alts.length) bump('又名重复');
    if (Array.isArray(b.authors) && new Set(b.authors).size !== b.authors.length) bump('authors 重复');
  });
}
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(String(v).padStart(5), k, samples[k] ? `  例：${samples[k]}` : '');
}
console.log('合计', Object.values(counts).reduce((a, b) => a + b, 0), '项');
