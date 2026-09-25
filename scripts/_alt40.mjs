// 一次性：第 40 轮 —— 异名登记 + 纠正前轮的误登记
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const MAP = [
  ['博来·法拉先生', ['博莱特·法拉']],
  ['一先令蜡烛', ['歌唱的沙']],
  ['血之罪', ['血之罪·精华本']],
  ['性之罪', ['性之罪·精华本']],
];
// 需要**撤下**的误登记：《一张俊美的脸》实为 To Love and Be Wise，不是 Brat Farrar
const REMOVE = [['博来·法拉先生', '一张俊美的脸']];

let added = 0, removed = 0;
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const p = `data/books/${f}`;
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  let dirty = false;
  for (const b of arr) {
    for (const [t, alts] of MAP) {
      if (b.title !== t) continue;
      b.alternateTitles = b.alternateTitles || [];
      for (const a of alts) if (!b.alternateTitles.includes(a)) { b.alternateTitles.push(a); added++; dirty = true; console.log(`+ ${b.title} ← ${a}  (${f})`); }
    }
    for (const [t, name] of REMOVE) {
      if (b.title !== t) continue;
      if ((b.alternateTitles || []).includes(name)) {
        b.alternateTitles = b.alternateTitles.filter((x) => x !== name);
        removed++; dirty = true;
        console.log(`- ${b.title} ✗ ${name}（实为独立作品 To Love and Be Wise，已撤下）(${f})`);
      }
    }
  }
  if (dirty) writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf8');
}
console.log(`共补 ${added} 条异名，撤下 ${removed} 条误登记`);
