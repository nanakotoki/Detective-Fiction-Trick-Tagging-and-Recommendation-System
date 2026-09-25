// 一次性：登记《神秘房客》为库内《房客》的异名（同作者朗兹／Lowndes，同一部 The Lodger）
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const p = `data/books/${f}`;
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  let dirty = false;
  for (const b of arr) {
    if (b.title !== '房客' || !/朗兹/.test(b.author)) continue;
    b.alternateTitles = b.alternateTitles || [];
    if (!b.alternateTitles.includes('神秘房客')) {
      b.alternateTitles.push('神秘房客');
      dirty = true;
      console.log(`+ 《${b.title}》(${b.id}) ← 又名「神秘房客」（重庆大学出版社 2015 版，著者译作「朗蒂丝」）`);
    }
  }
  if (dirty) writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf8');
}
