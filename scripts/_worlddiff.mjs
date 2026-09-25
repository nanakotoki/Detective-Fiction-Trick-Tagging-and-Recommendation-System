import { readFileSync, readdirSync } from 'node:fs';
const books = [];
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  for (const b of Array.isArray(j) ? j : j.books || []) books.push(b);
}
const norm = (s) =>
  String(s || '')
    .replace(/[\s:：·・,，.。()（）[\]【】\-—_/、；;]/g, '')
    .replace(/第[一二三四五六七八九十\d]+[部卷册季集]/g, '');
const db = new Map();
for (const b of books) {
  db.set(norm(b.title), b);
  for (const a of b.alternateTitles || []) db.set(norm(a), b);
}
const rows = readFileSync(process.argv[2] || '_dd/clc-world.tsv', 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => l.split('\t'))
  .filter((c) => c[1] !== '__DONE__');
let neu = 0;
for (const c of rows) {
  const [clc, title, author, call, pub, isbn, subj] = c;
  const n = norm(title);
  if (db.has(n)) {
    console.log(`  ✓已有  ${title} ／ ${author}  [${clc}]`);
    continue;
  }
  const partial = books.find((b) => {
    const t = norm(b.title);
    return t && (t.includes(n) || n.includes(t)) && Math.min(t.length, n.length) >= 4;
  });
  if (partial) {
    console.log(`  ~近似  ${title}  ≈库内《${partial.title}》 ／ ${author}  [${clc}]`);
    continue;
  }
  neu += 1;
  console.log(`  ★新    ${title} | ${author} | ${call} | ${pub} | ${isbn} | ${(subj || '').slice(0, 30)}`);
}
console.log(`\n共 ${rows.length} 行，库内没有的候选 ${neu} 条`);
