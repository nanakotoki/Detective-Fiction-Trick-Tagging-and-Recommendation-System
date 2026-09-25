// 一次性：撤掉与《酒店关门之后》重复的条目，并登记异名
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const p = 'data/books/batch-131-opac6intl.json';
const arr = JSON.parse(readFileSync(p, 'utf8'));
const kept = arr.filter((b) => b.id !== 'author131-016');
console.log('移除', arr.length - kept.length, '条 →', kept.length, '条');
writeFileSync(p, JSON.stringify(kept, null, 2) + '\n', 'utf8');

for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const fp = `data/books/${f}`;
  const a = JSON.parse(readFileSync(fp, 'utf8'));
  let dirty = false;
  for (const b of a) {
    if (b.title !== '酒店关门之后') continue;
    b.alternateTitles = b.alternateTitles || [];
    if (!b.alternateTitles.includes('酒吧关门之后')) { b.alternateTitles.push('酒吧关门之后'); dirty = true; console.log(`+ ${b.title} ← 酒吧关门之后  (${f})`); }
  }
  if (dirty) writeFileSync(fp, JSON.stringify(a, null, 2) + '\n', 'utf8');
}
