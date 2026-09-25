// 一次性：第 37 轮同书异名登记
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const MAP = [
  ['首席女法医1：尸体会说话', ['首席女法医01：尸体会说话']],
  ['法兰柴思事件', ['弗朗才斯绑架案']],
  ['首相绑架案', ['首相绑架案波洛探案集']],
];
let n = 0;
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const p = `data/books/${f}`;
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  let dirty = false;
  for (const b of arr) for (const [t, alts] of MAP) {
    if (b.title !== t) continue;
    b.alternateTitles = b.alternateTitles || [];
    for (const a of alts) if (!b.alternateTitles.includes(a)) { b.alternateTitles.push(a); dirty = true; n++; console.log(`+ ${b.title} ← ${a}  (${f})`); }
  }
  if (dirty) writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf8');
}
console.log('共补', n, '条异名');
