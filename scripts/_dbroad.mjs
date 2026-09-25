// 一次性：给「大类号」扫出的候选批量取详情（提要/丛编/中图/著者），结果写 TSV
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { detail } from './lib/uibe.mjs';

const TITLES = process.argv.slice(2);
const outFile = '_dd/broad-detail.tsv';
const rows = readFileSync('_dd/clc-broad.tsv', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
const done = new Set();
if (existsSync(outFile)) for (const l of readFileSync(outFile, 'utf8').split(/\r?\n/)) if (l.trim()) done.add(l.split('\t')[1]);

let n = 0;
for (const t of TITLES) {
  if (done.has(t)) continue;
  const row = rows.find((r) => r[1] === t) || rows.find((r) => r[1] && r[1].startsWith(t));
  if (!row) {
    console.log(`✗ 表里找不到：${t}`);
    continue;
  }
  const [clc, title, author, callNumber, publisher, isbn, subjects, bookId] = row;
  let rec;
  try {
    const d = await detail(bookId);
    rec = [clc, title, author, d.imprint || publisher, d.clc || '', d.subjects || subjects, d.series || '', d.titleNote || '', (d.abstract || '').replace(/\s+/g, ' '), d.author || ''];
  } catch (e) {
    rec = [clc, title, author, publisher, '', subjects, '', '', `取详情失败：${e.message}`, ''];
  }
  appendFileSync(outFile, rec.join('\t') + '\n', 'utf8');
  n += 1;
  await new Promise((r) => setTimeout(r, 700));
}
console.log(`本次取详情 ${n} 条 → ${outFile}`);
writeFileSync('_dd/broad-detail.done', String(Date.now()), 'utf8');
