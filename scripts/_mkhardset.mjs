// 一次性：从 clc-scan.tsv 里筛出「主题词硬判据」且库内没有的候选
import { readFileSync, writeFileSync } from 'node:fs';
import { loadSeedBooks } from '../web/js/core/seed.js';

const books = loadSeedBooks();
const norm = (s) =>
  String(s).replace(/[\s:：·・,，.。()（）[\]【】\-—_]/g, '').replace(/第[一二三四五六七八九十\d]+[部卷册季]/g, '');
const db = new Map();
for (const b of books) {
  db.set(norm(b.title), b);
  for (const a of b.alternateTitles || []) db.set(norm(a), b);
}

const rows = readFileSync('_dd/clc-scan.tsv', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
const hard = [];
for (const r of rows) {
  if (r[1] === '__DONE__') continue;
  const subjects = (r[6] || '').replace(/&nbsp;/g, ' ');
  if (!/推理小说|侦探小说/.test(subjects)) continue;
  if (db.has(norm(r[1]))) continue;
  hard.push(r.join('\t'));
}
writeFileSync('_dd/clc-hard.txt', hard.join('\n') + '\n', 'utf8');
console.log('硬判据候选写入', hard.length, '条 → _dd/clc-hard.txt');
