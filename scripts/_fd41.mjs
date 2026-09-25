// 一次性：从已保存的扫描 TSV 里按题名找 bookId，再取详情
import { readFileSync, existsSync } from 'node:fs';
import { detail, subjectVerdict } from './lib/uibe.mjs';

// facet.tsv:  题名 · site · 著者 · 出版 · 主题 · bookId
// author-scan: 作者 · 题名 · 著者 · 主题 · 出版者 · ISBN · bookId
const FILES = [
  ['_dd/facet.tsv', 0, 1, 2, 3, 5],
  ['_dd/facet2.tsv', 0, 1, 2, 3, 5],
  ['_dd/author-scan.tsv', 1, null, 2, 4, 6],
  ['_dd/author-scan2.tsv', 1, null, 2, 4, 6],
  ['_dd/author-scan3.tsv', 1, null, 2, 4, 6],
  ['_dd/author-scan4.tsv', 1, null, 2, 4, 6],
];
const rows = [];
for (const [f, ti, si, ai, pi, bi] of FILES) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const c = line.split('\t');
    if (c[1] === '__DONE__') continue;
    if (!c[ti] || !c[bi]) continue;
    rows.push({ file: f, title: c[ti].split('|')[0], site: si === null ? 'uibe' : c[si], author: c[ai], pub: c[pi], bookId: c[bi] });
  }
}

for (const w of process.argv.slice(2)) {
  const exact = w.startsWith('=');
  const key = exact ? w.slice(1) : w;
  const hit = exact ? rows.find((r) => r.title === key) : rows.find((r) => r.title.includes(key));
  console.log(`\n### ${w}`);
  if (!hit) { console.log('  （扫描表里没有）'); continue; }
  console.log(`  表中题名=${hit.title} | site=${hit.site} | 著者=${hit.author} | 出版=${hit.pub}`);
  try {
    const d = await detail(hit.bookId, { site: hit.site });
    const v = subjectVerdict(d.subjects);
    console.log(`  判据=${v.mystery ? '★是' : '否'} | 主题=${d.subjects || '-'}`);
    console.log(`  丛编=${d.series || '-'} | 中图=${d.clc || '-'} | 出版=${d.imprint || '-'}`);
    console.log(`  提要=${(d.abstract || '-').slice(0, 190)}`);
  } catch (e) { console.log(`  详情失败：${e.message}`); }
  await new Promise((r) => setTimeout(r, 750));
}
