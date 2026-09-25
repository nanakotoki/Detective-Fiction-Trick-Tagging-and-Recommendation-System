// 一次性：批量取详情 + 库内查重
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { detail, subjectVerdict } from './lib/uibe.mjs';

const books = [];
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  for (const b of j.books || j) books.push(b);
}
const rows = readFileSync('_dd/facet.tsv', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));

for (const w of process.argv.slice(2)) {
  const row = rows.find((c) => (c[0] || '').includes(w));
  const dup = books.filter((b) => b.title.includes(w) || w.includes(b.title));
  console.log(`\n### ${w}${dup.length ? '  ⚠库内已有: ' + dup.map((d) => d.title + '/' + d.author).join(' ; ') : ''}`);
  if (!row) { console.log('  （facet 无此行）'); continue; }
  try {
    const d = await detail(row[5], { site: row[1] });
    const v = subjectVerdict(d.subjects);
    console.log(`  题名=${(row[0] || '').split('|')[0]} | 著者=${row[2]} | 出版=${row[3]}`);
    console.log(`  主题=${d.subjects || '-'} → ${v.mystery ? '★是' : '否'}`);
    console.log(`  丛编=${d.series || '-'} | 附注=${d.titleNote || '-'}`);
    console.log(`  提要=${(d.abstract || '-').slice(0, 150)}`);
  } catch (e) { console.log(`  失败：${e.message}`); }
  await new Promise((r) => setTimeout(r, 560));
}
