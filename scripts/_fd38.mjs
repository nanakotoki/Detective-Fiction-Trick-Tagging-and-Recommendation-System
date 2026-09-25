// 一次性：按 author-scan.tsv 的 (作者,题名) 取详情
import { readFileSync } from 'node:fs';
import { detail, subjectVerdict } from './lib/uibe.mjs';

const rows = readFileSync('_dd/author-scan.tsv', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
const want = process.argv.slice(2);
for (const w of want) {
  const row = rows.find((c) => c[1] && c[1].includes(w));
  if (!row) { console.log(`\n### ${w} （扫描结果里没有）`); continue; }
  console.log(`\n### ${row[1]}`);
  try {
    const d = await detail(row[6]);
    const v = subjectVerdict(d.subjects);
    console.log(`  著者=${row[2]} | 出版=${d.imprint || row[4]} | ${v.mystery ? '★是' : '否'}`);
    console.log(`  主题=${d.subjects || '-'}`);
    console.log(`  丛编=${d.series || '-'} | 原题=${d.titleNote || '-'} | 中图=${d.clc || '-'}`);
    console.log(`  提要=${(d.abstract || '-').slice(0, 130)}`);
  } catch (e) { console.log(`  失败：${e.message}`); }
  await new Promise((r) => setTimeout(r, 700));
}
