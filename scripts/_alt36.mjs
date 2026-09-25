// 一次性：按题名给库内条目补 alternateTitles
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const MAP = [
  ['帷幕', ['幕后凶手']],
  ['死亡通知单', ['死亡通知单·暗黑者']],
  ['大唐悬疑录：最后的狄仁杰', ['大唐悬疑录5 最后的狄仁杰']],
  ['罗杰疑案', ['罗杰·爱克罗伊德谋杀案']],
  ['尼罗河上的惨案', ['尼罗河谋杀案']],
  ['万圣节前夜的谋杀', ['万圣节前夜的谋杀案']],
  ['山核桃大街谋杀案', ['外国学生宿舍谋杀案', '国际学舍谋杀案']],
];
let changed = 0;
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const p = `data/books/${f}`;
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  let dirty = false;
  for (const b of arr) {
    for (const [title, alts] of MAP) {
      if (b.title !== title) continue;
      b.alternateTitles = b.alternateTitles || [];
      for (const a of alts) {
        if (!b.alternateTitles.includes(a)) { b.alternateTitles.push(a); dirty = true; changed++; console.log(`+ ${b.title} ← ${a}  (${f})`); }
      }
    }
  }
  if (dirty) writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf8');
}
console.log('共补', changed, '条异名');
