/**
 * 按丛书关键词从当当枚举结果里找缺口
 * ================================
 * 用户的扩面口径是「优先从出版社的推理专门丛书枚举」。豆瓣丛书页 403 之后，
 * 这条路线改走当当：**很多丛书名就写在商品标题里**（例如「罗杰疑案 3版 … 午夜文库 当当自营」），
 * 所以把整类枚举下来的 `_dd/cat-all.tsv` 按丛书关键词一筛，就是一份丛书书目候选。
 *
 * ⚠️ 当当不是编目数据，**筛出来的只是候选**：题材判据一律另取
 * （对外经贸/重庆工商 OPAC 的题名主题、CIP 关键词），见 docs/collection-backlog.md §10。
 *
 * 用法：
 *   node scripts/dd-series-scan.mjs _dd/cat-all.tsv 午夜文库 [更多关键词…]
 *   node scripts/dd-series-scan.mjs _dd/cat-all.tsv 千本樱 --out _dd/series-gap.tsv
 */
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { leadTitle } from './lib/dd-title.mjs';

const argv = process.argv.slice(2);
const tsv = argv[0];
const outIdx = argv.indexOf('--out');
const outFile = outIdx >= 0 ? argv[outIdx + 1] : '';
const kws = argv.slice(1).filter((a) => !a.startsWith('--') && a !== outFile);

if (!tsv || !kws.length) {
  console.error('用法: node scripts/dd-series-scan.mjs <当当TSV> <丛书关键词…> [--out 输出]');
  process.exit(1);
}

const normTitle = (s) =>
  String(s)
    .replace(/[（(【\[][^）)】\]]{0,20}[）)】\]]/g, '')
    .replace(/[\s:：·・、,，.。!！?？'"“”‘’—-]/g, '')
    .trim();

const DIR = 'data/books';
const titles = new Set();
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  for (const b of JSON.parse(readFileSync(path.join(DIR, f), 'utf8'))) {
    if (b.title) titles.add(normTitle(b.title));
    for (const t of b.alternateTitles ?? []) titles.add(normTitle(t));
  }
}

const rows = readFileSync(tsv, 'utf8').split(/\r?\n/).filter(Boolean);
const out = [];
for (const kw of kws) {
  const seen = new Set();
  const hits = [];
  for (const line of rows) {
    const [id, rawTitle, authorLine, detail] = line.split('\t');
    if (!`${rawTitle} ${detail}`.includes(kw)) continue;
    const t = leadTitle(rawTitle);
    const nt = normTitle(t);
    if (!nt || seen.has(nt)) continue;
    seen.add(nt);
    if (titles.has(nt)) continue; // 已在库
    hits.push({ kw, id, title: t, authorLine: (authorLine ?? '').replace(/加入购物车收藏.*$/, '') });
  }
  console.log(`\n########## 「${kw}」：扫描 ${rows.length} 行，题名含该丛书名的 ${seen.size} 个，**库内没有的 ${hits.length} 个**`);
  for (const h of hits.slice(0, 45)) console.log(`  · ${h.title}\t${h.authorLine.slice(0, 44)}`);
  if (hits.length > 45) console.log(`  … 另有 ${hits.length - 45} 个`);
  out.push(...hits);
}

if (outFile) {
  appendFileSync(outFile, out.map((h) => [h.kw, h.title, h.id, h.authorLine].join('\t')).join('\n') + '\n', 'utf8');
  console.log(`\n已写入 ${outFile}（${out.length} 行）`);
}
