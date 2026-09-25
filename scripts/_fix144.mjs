// 一次性：撤掉 batch-144 里 4 条与库内重复的条目，改为在既有条目上登记异名
// 它们都是「同一部作品的不同中译名」，我按中文书名查重时漏了；
// 是 find-duplicates 用 originalTitle 比对才抓出来的。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const DROP = {
  'clc144-002': { keep: 'cnmod-017', alt: '' }, // 清明上河图密码.2 ↔ 清明上河图密码 2（仅空格差异，不登记异名）
  'clc144-011': { keep: 'md55-005', alt: '烟囱宅之谜' },
  'clc144-012': { keep: 'christie109-007', alt: '' }, // 煦阳岭疑云 ↔ 煦阳岭的疑云（仅一字差异，不登记异名）
  'clc144-013': { keep: 'christie109-004', alt: '致命遗产' },
};

// 1) 从 batch-144 删掉这 4 条
const p = 'data/books/batch-144-clc.json';
const arr = JSON.parse(readFileSync(p, 'utf8'));
const kept = arr.filter((b) => !DROP[b.id]);
for (const b of arr) {
  if (!DROP[b.id]) continue;
  console.log(`− 删除 ${b.id} 《${b.title}》 → 库内已有 ${DROP[b.id].keep}`);
}
writeFileSync(p, JSON.stringify(kept, null, 2) + '\n', 'utf8');

// 2) 在既有条目上登记真正不同的中译名
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const q = `data/books/${f}`;
  const list = JSON.parse(readFileSync(q, 'utf8'));
  let dirty = false;
  for (const b of list) {
    for (const [dropId, cfg] of Object.entries(DROP)) {
      if (b.id !== cfg.keep || !cfg.alt) continue;
      b.alternateTitles = b.alternateTitles || [];
      if (!b.alternateTitles.includes(cfg.alt)) {
        b.alternateTitles.push(cfg.alt);
        dirty = true;
        console.log(`+ 《${b.title}》(${b.id}) ← 又名「${cfg.alt}」`);
      }
    }
  }
  if (dirty) writeFileSync(q, JSON.stringify(list, null, 2) + '\n', 'utf8');
}
console.log('\n完成，batch-144 现', kept.length, '条');
