import { readFileSync, existsSync } from 'node:fs';
import { loadSeedBooks } from '../web/js/core/seed.js';
import { authorListOf } from '../web/js/core/seed.js';

const books = loadSeedBooks();
const count = new Map();
for (const b of books) {
  for (const a of authorListOf(b)) count.set(a, (count.get(a) || 0) + 1);
}

// 已扫过的作者：从各轮 author-scan 的 TSV 里收集（行格式：作者\t题名\t…）
const scanned = new Set();
const FILES = [];
for (let i = 1; i <= 6; i += 1) {
  const f = i === 1 ? '_dd/author-scan.tsv' : `_dd/author-scan${i}.tsv`;
  if (existsSync(f)) FILES.push(f);
}
for (const f of FILES) {
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const c = line.split('\t');
    if (c[1] === '__DONE__') continue;
    if (c[0]) scanned.add(c[0].trim());
  }
}

const todo = [...count.entries()]
  .filter(([a, n]) => n >= 3 && !scanned.has(a))
  .sort((a, b) => b[1] - a[1]);

console.log(`作者总数 ${count.size}，已扫描 ${scanned.size}，**待扫（≥3 部）${todo.length} 位**`);
console.log(`扫描记录文件：${FILES.join(', ')}\n`);
todo.slice(0, 80).forEach(([a, n], i) => console.log(`${String(i + 1).padStart(3)}. ${a}（${n} 部）`));
if (todo.length > 80) console.log(`…另有 ${todo.length - 80} 位`);
console.log('\n=== 前 60 位的逗号分隔（可直接喂给 opac-author-scan）===');
console.log(todo.slice(0, 60).map(([a]) => a).join(','));
