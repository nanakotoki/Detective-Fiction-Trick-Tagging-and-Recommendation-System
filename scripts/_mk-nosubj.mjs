// 一次性：从 clc-scan.tsv 里筛出「无主题词」且库内没有的候选
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

const rows = readFileSync('_dd/clc-scan.tsv', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
const out = [];
for (const r of rows) {
  if (r[1] === '__DONE__') continue;
  const subjects = (r[6] || '').replace(/&nbsp;/g, ' ').trim();
  // 「无主题词」桶：检索行完全没有主题词
  if (subjects) continue;
  if (db.has(norm(r[1]))) continue;
  out.push(r.join('\t'));
}
writeFileSync('_dd/clc-nosubj.txt', out.join('\n') + '\n', 'utf8');
console.log('无主题词候选写入', out.length, '条 → _dd/clc-nosubj.txt');
