import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { loadSeedBooks, authorListOf } from '../web/js/core/seed.js';

const books = loadSeedBooks();
const m = new Map();
for (const b of books) for (const a of authorListOf(b)) m.set(a, (m.get(a) ?? 0) + 1);

const scanned = new Set();
for (const f of ['_dd/author-scan.tsv', '_dd/author-scan2.tsv', '_dd/author-scan3.tsv', '_dd/author-scan4.tsv', '_dd/author-scan5.tsv']) {
  if (!existsSync(f)) continue;
  for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) if (l.split('\t')[1] === '__DONE__') scanned.add(l.split('\t')[0]);
}
const all = [...m.entries()].sort((a, b) => b[1] - a[1]);
const todo = all.filter(([a, n]) => n >= 3 && !scanned.has(a));
console.log(`作者总数 ${all.length}，已扫描 ${scanned.size}，待扫（≥3 部）${todo.length}`);
console.log('\n== 待扫作者（按在库部数降序，最多 60 位）');
console.log(todo.slice(0, 60).map(([a]) => a).join(','));
