// 一次性：第 39 轮同书异名登记
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const MAP = [
  ['弄假成真', ['死人的殿堂']],
  ['波洛的圣诞节', ['圣诞奇案']],
  ['漫长的告别', ['长相别', '漫长的道别']],
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
// 顺手把《研究斯宾诺莎的贼》的封面副题名记进新条目
const p = 'data/books/batch-131-opac6intl.json';
const arr = JSON.parse(readFileSync(p, 'utf8'));
for (const b of arr) if (b.id === 'author131-009') { b.alternateTitles = ['喜欢研究哲学的贼']; console.log('+ 研究斯宾诺莎的贼 ← 喜欢研究哲学的贼（馆藏封面其他题名）'); }
writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf8');
console.log('共补', n, '条异名');
