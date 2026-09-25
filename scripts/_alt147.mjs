// 一次性：登记两条同书异名（本轮跨馆复核时发现）
// 1) 《火焰冰封的迷宫》(人民文学 2017) = 库内《冰封火焰之谜》——同作者汉肖、同为「伦敦黄金失窃 + 克里克」这一情节
// 2) 《马耳他黑鹰》(上海译文 2001) = 库内《马耳他之鹰》——同一部 *The Maltese Falcon* 的另一译名
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const PAIRS = [
  { keepTitle: '冰封火焰之谜', alt: '火焰冰封的迷宫' },
  { keepTitle: '马耳他之鹰', alt: '马耳他黑鹰' },
];

for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const p = `data/books/${f}`;
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  let dirty = false;
  for (const b of arr) {
    for (const { keepTitle, alt } of PAIRS) {
      if (b.title !== keepTitle) continue;
      b.alternateTitles = b.alternateTitles || [];
      if (!b.alternateTitles.includes(alt)) {
        b.alternateTitles.push(alt);
        dirty = true;
        console.log(`+ 《${b.title}》(${b.id}) ← 又名「${alt}」`);
      }
    }
  }
  if (dirty) writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf8');
}
