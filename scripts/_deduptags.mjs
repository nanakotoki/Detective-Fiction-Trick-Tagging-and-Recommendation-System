// 一次性：全库标签去重（重复标签会让标签页的「收录数」多算）
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
let files = 0;
let fixed = 0;
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const p = `data/books/${f}`;
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  let dirty = false;
  for (const b of arr) {
    for (const key of ['tags', 'school']) {
      if (!Array.isArray(b[key])) continue;
      const seen = new Set();
      const out = [];
      for (const t of b[key]) {
        if (seen.has(t)) continue;
        seen.add(t);
        out.push(t);
      }
      if (out.length !== b[key].length) {
        console.log(`${b.id} 《${b.title}》 ${key}: ${b[key].join(',')} → ${out.join(',')}`);
        b[key] = out;
        dirty = true;
        fixed += 1;
      }
    }
  }
  if (dirty) {
    writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf8');
    files += 1;
  }
}
console.log(`\n去重 ${fixed} 处，写入 ${files} 个文件`);
