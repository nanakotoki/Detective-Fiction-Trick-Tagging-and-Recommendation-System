// 一次性：按丛书关键词翻页枚举当当条目（保留短简介与作者行，供取证）
// 用法: node scripts/_dd-series.mjs 蜘蛛文库 [最多页数] [输出TSV]
import { writeFileSync } from 'node:fs';
import { fetchDecoded, parseSearch, strip } from './lib/dangdang.mjs';
import { leadTitle } from './lib/dd-title.mjs';

const kw = process.argv[2];
const maxPages = Number(process.argv[3] || 5);
const outFile = process.argv[4] || '';
if (!kw) {
  console.error('用法: node scripts/_dd-series.mjs <丛书关键词> [最多页数] [输出TSV]');
  process.exit(1);
}

const seen = new Map();
for (let p = 1; p <= maxPages; p++) {
  const url = `http://search.dangdang.com/?key=${encodeURIComponent(kw)}&act=input&page_index=${p}`;
  const rows = parseSearch(await fetchDecoded(url));
  const fresh = rows.filter((r) => !seen.has(r.id));
  console.log(`第 ${p} 页：解析 ${rows.length} 条，新增 ${fresh.length} 条`);
  for (const r of fresh) seen.set(r.id, r);
  if (rows.length === 0) break;
  await new Promise((r) => setTimeout(r, 700));
}

const all = [...seen.values()];
const hits = all.filter((r) => r.title.includes(kw));
console.log(`\n合计 ${all.length} 条，题名含「${kw}」的 ${hits.length} 条`);

const lines = hits.map((r, i) =>
  [i + 1, r.id, leadTitle(r.title), strip(r.authorLine), strip(r.detail)].join('\t')
);
if (outFile) {
  writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');
  console.log(`已写入 ${outFile}（${lines.length} 行）\n`);
}
for (const l of lines.slice(0, 6)) console.log(l.slice(0, 220));
