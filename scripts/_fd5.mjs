// 一次性：facet.tsv 候选与库内比对，列出「库内没有的」
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const norm = (s) =>
  String(s)
    .replace(/[（(【\[][^）)】\]]{0,20}[）)】\]]/g, '')
    .replace(/[\s:：·・、,，.。!！?？'"“”‘’—-]/g, '')
    .trim();

const DIR = 'data/books';
const have = new Set();
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  for (const b of JSON.parse(readFileSync(path.join(DIR, f), 'utf8'))) {
    if (b.title) have.add(norm(b.title));
    for (const t of b.alternateTitles ?? []) have.add(norm(t));
  }
}

const rows = readFileSync('_dd/facet.tsv', 'utf8').split(/\r?\n/).filter(Boolean);
const out = [];
const seen = new Set();
let inLib = 0;
for (const line of rows) {
  const c = line.split('\t');
  const title = c[0].split('|')[0];
  const n = norm(title);
  if (!n) continue;
  if (have.has(n)) { inLib++; continue; }
  if (seen.has(n)) continue;
  seen.add(n);
  out.push({ title, site: c[1], author: c[2], subjects: c[4] });
}
writeFileSync('_dd/facet-new.txt', out.map((o) => o.title).join('\n') + '\n', 'utf8');
console.log(`候选 ${rows.length} 行 → 库内已有 ${inLib}、**库内没有的 ${out.length} 条**\n`);
// 只打印「像是单本小说」的（排除研究/评论/选集）
const ANTH = /(选|大全|精华|获奖|年度|精选|经典故事|名著|读本|研究|评论|艺术|简史|指南|教程|赏析|探奇|之谜$)/;
let n = 0;
for (const o of out) {
  if (ANTH.test(o.title)) continue;
  console.log(`  [${o.site}] ${o.title} ‖ ${o.author.slice(0, 24)} ‖ ${o.subjects.slice(0, 22)}`);
  if (++n > 70) break;
}
