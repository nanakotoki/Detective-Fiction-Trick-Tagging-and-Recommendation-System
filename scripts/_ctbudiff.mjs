import { readFileSync, writeFileSync } from 'node:fs';
import { loadSeedBooks } from '../web/js/core/seed.js';

const books = loadSeedBooks();
const norm = (s) =>
  String(s).replace(/[\s:：·・,，.。()（）[\]【】\-—_=]/g, '').replace(/第[一二三四五六七八九十\d]+[部卷册季]/g, '');
const db = new Map();
for (const b of books) {
  db.set(norm(b.title), b);
  for (const a of b.alternateTitles || []) db.set(norm(a), b);
}

const file = process.argv[2] || '_dd/ctbu-scan.tsv';
const rows = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
const fresh = [];
const seen = new Set();
for (const r of rows) {
  const [kw, title, author, imprint, clc, subjects, series, abstract, bookId] = r;
  if (title === '__DONE__' || !title) continue;
  const n = norm(title);
  if (seen.has(n)) continue;
  seen.add(n);
  if (db.has(n)) continue;
  const partial = books.find((b) => {
    const t = norm(b.title);
    return t && (t.includes(n) || n.includes(t)) && Math.min(t.length, n.length) >= 5;
  });
  fresh.push({ kw, title, author, imprint, clc, subjects, series, abstract, approx: partial ? `≈《${partial.title}》` : '' });
}
writeFileSync('_dd/ctbu-fresh.txt', fresh.map((r) => [r.title, r.author, r.imprint, r.clc, r.subjects, r.series, r.abstract, r.approx].join('\t')).join('\n') + '\n', 'utf8');
console.log(`第二馆共 ${seen.size} 条候选，**库内没有的 ${fresh.length} 条**\n`);
fresh.forEach((r, i) => {
  console.log(`${String(i + 1).padStart(3)}. ${r.title} | ${r.author} | ${r.imprint} | 中图:${r.clc} | ${r.subjects}${r.approx ? '  ' + r.approx : ''}`);
  if (r.abstract) console.log(`      ${r.abstract.slice(0, 100)}`);
});
