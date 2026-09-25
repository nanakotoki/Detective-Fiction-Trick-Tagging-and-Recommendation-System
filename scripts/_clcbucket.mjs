import { readFileSync } from 'node:fs';
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
const buckets = { 硬判据: [], 恐怖惊悚: [], 间谍: [], 无主题词: [], 其他: [] };
for (const [clc, title, author, callNumber, publisher, isbn, subjects, bookId] of rows) {
  if (title === '__DONE__') continue;
  const n = norm(title);
  if (db.has(n)) continue;
  const s = (subjects || '').replace(/&nbsp;/g, ' ');
  const rec = { clc, title, author, publisher, callNumber, subjects: s, bookId };
  if (/推理小说|侦探小说/.test(s)) buckets.硬判据.push(rec);
  else if (/恐怖小说|惊悚小说|惊险小说/.test(s)) buckets.恐怖惊悚.push(rec);
  else if (/间谍小说/.test(s)) buckets.间谍.push(rec);
  else if (!s.trim()) buckets.无主题词.push(rec);
  else buckets.其他.push(rec);
}
for (const [k, v] of Object.entries(buckets)) {
  console.log(`\n===== ${k}：${v.length} 条 =====`);
  for (const r of v.slice(0, 200)) console.log(`[${r.clc}] ${r.title} | ${r.author} | ${r.publisher} | ${r.subjects}`);
}
