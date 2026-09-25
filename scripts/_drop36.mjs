// 一次性：撤掉与库内重复的两条，并把中译异名登记到既有条目
import { readFileSync, writeFileSync } from 'node:fs';
const drop = ['facet125-008', 'facet125-009'];
const p = 'data/books/batch-125-opac3intl.json';
const arr = JSON.parse(readFileSync(p, 'utf8'));
const kept = arr.filter((b) => !drop.includes(b.id));
console.log('移除', arr.length - kept.length, '条 →', kept.length, '条');
writeFileSync(p, JSON.stringify(kept, null, 2) + '\n', 'utf8');

const alt = [['格林家杀人事件', '葛蕾丝命案'], ['金丝雀杀人事件', '金丝雀命案']];
for (const f of ['batch-08-western-more.json', 'batch-10-golden-age.json']) {
  const fp = `data/books/${f}`;
  const a = JSON.parse(readFileSync(fp, 'utf8'));
  let dirty = false;
  for (const b of a) for (const [t, name] of alt) {
    if (b.title !== t) continue;
    b.alternateTitles = b.alternateTitles || [];
    if (!b.alternateTitles.includes(name)) { b.alternateTitles.push(name); dirty = true; console.log(`+ ${b.title} ← ${name}`); }
  }
  if (dirty) writeFileSync(fp, JSON.stringify(a, null, 2) + '\n', 'utf8');
}
