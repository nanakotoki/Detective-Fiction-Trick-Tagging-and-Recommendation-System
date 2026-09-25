// 一次性：第 38 轮第二批同书异名登记
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const MAP = [
  ['禁断的魔术', ['禁忌魔术', '神探伽利略.8：禁忌魔术']],
  ['虚像小丑', ['虚像的丑角']],
  ['龙卧亭杀人事件', ['龙卧亭事件·贝繁村谜团', '龙卧亭事件·隐秘的角落']],
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
