import { readFileSync, readdirSync } from 'node:fs';
const books = [];
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  for (const b of j.books || j) books.push(b);
}
const m = new Map();
for (const b of books) m.set(b.author, (m.get(b.author) || 0) + 1);
const scanned = new Set();
for (const f of ['_dd/author-scan.tsv', '_dd/author-scan2.tsv']) {
  try {
    for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) if (l.split('\t')[1] === '__DONE__') scanned.add(l.split('\t')[0]);
  } catch {}
}
const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
console.log('== 全部作者按在库部数排序（前 60）');
sorted.slice(0, 60).forEach(([a, n], i) => console.log(`${String(i + 1).padStart(3)}. ${a} ${n}${scanned.has(a) ? '  [已扫]' : ''}`));
console.log('\n== 未扫描且 ≥4 部的作者');
console.log(sorted.filter(([a, n]) => n >= 4 && !scanned.has(a)).map(([a]) => a).join(','));
