// 一次性：第 41 轮同书异名登记（尼古拉斯·布莱克 2 条 + 法医秦明 2 条）
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const MAP = [
  ['死亡之壳', ['逝灭之壳']],
  ['野兽必死', ['禽兽该死']],
  ['尸语者', ['法医秦明.上·尸语者', '尸语者·下']],
];
let n = 0;
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const p = `data/books/${f}`;
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  let dirty = false;
  for (const b of arr) for (const [t, alts] of MAP) {
    if (b.title !== t) continue;
    b.alternateTitles = b.alternateTitles || [];
    for (const a of alts) if (!b.alternateTitles.includes(a)) { b.alternateTitles.push(a); dirty = true; n++; console.log(`+ 《${b.title}》← ${a}  (${f})`); }
  }
  if (dirty) writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf8');
}
console.log('共补', n, '条异名');
