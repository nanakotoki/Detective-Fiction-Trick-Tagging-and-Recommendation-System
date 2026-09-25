// 一次性：把《哑证人》登记为库内《沉默的证人》的异名
// 依据：库内《沉默的证人》originalTitle = Dumb Witness（1937）；
// 而《哑证人》（贵州人民出版社 1998）的馆藏提要列出的正是「阿伦德尔小姐」——
// 这是 Dumb Witness 中被害人的姓氏，属**独一无二的人物名**，可作同一部作品的强证据。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
let n = 0;
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const p = `data/books/${f}`;
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  let dirty = false;
  for (const b of arr) {
    if (b.title !== '沉默的证人') continue;
    if (b.originalTitle !== 'Dumb Witness') { console.log('✗ 原题名不符，放弃登记'); continue; }
    b.alternateTitles = b.alternateTitles || [];
    if (!b.alternateTitles.includes('哑证人')) {
      b.alternateTitles.push('哑证人');
      dirty = true;
      n += 1;
      console.log(`+ 《${b.title}》← 哑证人  (${f})`);
    }
  }
  if (dirty) writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf8');
}
console.log('共补', n, '条异名');
