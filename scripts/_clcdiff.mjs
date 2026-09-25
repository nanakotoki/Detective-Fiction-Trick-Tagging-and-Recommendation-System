import { readFileSync } from 'node:fs';
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

const rows = readFileSync('_dd/clc-scan.tsv', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
const byClc = new Map();
const fresh = [];
for (const [clc, title, author, callNumber, publisher, isbn, subjects, bookId] of rows) {
  if (title === '__DONE__') continue;
  byClc.set(clc, (byClc.get(clc) || 0) + 1);
  const n = norm(title);
  if (db.has(n)) continue;
  const partial = books.find((b) => {
    const t = norm(b.title);
    return t && (t.includes(n) || n.includes(t)) && Math.min(t.length, n.length) >= 4;
  });
  fresh.push({ clc, title, author, callNumber, publisher, subjects: (subjects || '').replace(/&nbsp;/g, ' '), approx: partial ? `≈《${partial.title}》` : '' });
}
console.log('各类号条数：', [...byClc.entries()].map(([k, v]) => `${k}=${v}`).join(' '));
console.log(`\n库内没有的候选：${fresh.length} 条\n`);
for (const r of fresh) {
  console.log(`[${r.clc}] ${r.title} | ${r.author} | ${r.publisher} | ${r.callNumber} | ${r.subjects}${r.approx ? '  ' + r.approx : ''}`);
}
