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

const rows = readFileSync('_dd/verify.tsv', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
const byVerdict = new Map();
for (const r of rows) byVerdict.set(r[2], (byVerdict.get(r[2]) || 0) + 1);
console.log('判定分布：');
for (const [v, n] of [...byVerdict.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v}  ${n}`);

console.log('\n=== 硬判据 / 弱判据 且库内没有的 ===');
let k = 0;
for (const r of rows) {
  const [title, site, verdict, subjects, series, titleNote, imprint, abstract] = r;
  if (!/硬判据|弱判据/.test(verdict || '')) continue;
  const n = norm(title);
  if (db.has(n)) continue;
  const partial = books.find((b) => {
    const t = norm(b.title);
    return t && (t.includes(n) || n.includes(t)) && Math.min(t.length, n.length) >= 4;
  });
  k += 1;
  console.log(`\n${k}. 【${verdict}】${title}  @${site}`);
  console.log(`   著录：${imprint || '-'} | 丛编：${series || '-'} | 附注：${titleNote || '-'}`);
  console.log(`   主题：${subjects || '-'}`);
  if (partial) console.log(`   ⚠ 疑似库内已有《${partial.title}》`);
  console.log(`   提要：${(abstract || '-').slice(0, 110)}`);
}
console.log(`\n合计 ${k} 条待处理`);
