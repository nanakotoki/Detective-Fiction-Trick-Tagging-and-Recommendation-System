// 一次性：给中图法枚举出的「硬判据」候选批量取详情，结果写成 TSV
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { detail, subjectVerdict } from './lib/uibe.mjs';

const inFile = process.argv[2] || '_dd/clc-hard.txt';
const outFile = process.argv[3] || '_dd/clc-hard-detail.tsv';
const delay = Number(process.argv[4] || 700);

const done = new Set();
if (existsSync(outFile)) {
  for (const l of readFileSync(outFile, 'utf8').split(/\r?\n/)) {
    if (l.trim()) done.add(l.split('\t')[1]);
  }
}

const lines = readFileSync(inFile, 'utf8').split(/\r?\n/).filter(Boolean);
let n = 0;
for (const line of lines) {
  const c = line.split('\t');
  const [clc, title, author, callNumber, publisher, isbn, subjects, bookId] = c;
  if (done.has(bookId)) continue;
  let rec;
  try {
    const d = await detail(bookId);
    rec = [clc, bookId, title, author, d.imprint || publisher, d.clc || '', d.subjects || subjects, d.series || '', d.titleNote || '', (d.abstract || '').replace(/\s+/g, ' '), subjectVerdict(d.subjects).mystery ? 'Y' : 'N'];
  } catch (e) {
    rec = [clc, bookId, title, author, publisher, '', subjects, '', '', `取详情失败：${e.message}`, '?'];
  }
  appendFileSync(outFile, rec.join('\t') + '\n', 'utf8');
  n += 1;
  if (n % 20 === 0) console.log(`已取 ${n} 条…`);
  await new Promise((r) => setTimeout(r, delay));
}
console.log(`完成，本次新增 ${n} 条 → ${outFile}`);
writeFileSync('_dd/clc-hard-detail.done', String(Date.now()), 'utf8');
