import { readFileSync, readdirSync } from 'node:fs';
import { loadSeedBooks } from '../web/js/core/seed.js';

const books = loadSeedBooks();
const norm = (s) =>
  String(s)
    .replace(/[\s:：·・,，.。()（）[\]【】\-—_]/g, '')
    .replace(/第[一二三四五六七八九十\d]+[部卷册季]/g, '');
const db = new Map();
for (const b of books) {
  db.set(norm(b.title), b);
  for (const a of b.alternateTitles || []) db.set(norm(a), b);
}

const f = process.argv[2] || '_dd/facet2.tsv';
const rows = readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
const seen = new Set();
const out = [];
for (const c of rows) {
  const [title, site, author, publisher, subjects, bookId] = c;
  const n = norm(title);
  if (seen.has(n)) continue;
  seen.add(n);
  if (db.has(n)) continue;
  const partial = books.find((b) => {
    const t = norm(b.title);
    return t && (t.includes(n) || n.includes(t)) && Math.min(t.length, n.length) >= 4;
  });
  out.push({ title, site, author, publisher, subjects: (subjects || '').replace(/&nbsp;/g, ' ').trim(), note: partial ? `≈库内《${partial.title}》` : '' });
}
console.log(`候选 ${seen.size} 条，库内没有的 ${out.length} 条\n`);
for (const r of out) console.log(`${r.title} | ${r.author} | ${r.publisher} | ${r.subjects}${r.note ? '  ' + r.note : ''}`);
