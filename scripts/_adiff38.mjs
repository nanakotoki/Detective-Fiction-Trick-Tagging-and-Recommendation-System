import { readFileSync, readdirSync } from 'node:fs';
const books = [];
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  for (const b of j.books || j) books.push(b);
}
const norm = (s) => String(s).replace(/[\s:：·,，.。()（）[\]【】\-—_]/g, '').replace(/第[一二三四五六七八九十\d]+[部卷册季]/g, '');
const dbByTitle = new Map();
for (const b of books) {
  dbByTitle.set(norm(b.title), b);
  for (const a of b.alternateTitles || []) dbByTitle.set(norm(a), b);
}
const rows = readFileSync(process.argv[2] || '_dd/author-scan.tsv', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
let newCount = 0;
let cur = '';
for (const c of rows) {
  if (c[1] === '__DONE__') continue;
  if (c[0] !== cur) { cur = c[0]; console.log(`\n=== ${cur}`); }
  const n = norm(c[1]);
  const hit = dbByTitle.get(n);
  if (hit) { console.log(`  ✓已有  ${c[1]}`); continue; }
  // 也检查包含关系（中译名带副题名等）
  const partial = books.find((b) => { const t = norm(b.title); return t && (t.includes(n) || n.includes(t)) && Math.min(t.length, n.length) >= 4; });
  if (partial) { console.log(`  ~近似 ${c[1]}  ≈库内《${partial.title}》`); continue; }
  newCount++;
  console.log(`  ★新    ${c[1]} | ${c[2]} | ${c[3]} | ${c[4] || '-'}`);
}
console.log(`\n库内没有的候选共 ${newCount} 条`);
