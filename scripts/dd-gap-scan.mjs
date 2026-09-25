/**
 * 从当当分类枚举结果里筛出「最该补的缺口」
 * ==========================================
 * 背景：当当分类页（侦探/悬疑/推理）能整类翻页枚举，五种排序各给出不同的前 6000 条切片，
 * 合起来是一万六千余条候选。但这一万六千里绝大多数是网络小说、盗墓类与重复版本，
 * **不能整类照收**（用户口径：可以扩充，但每一部都要能确认是推理小说）。
 *
 * 真正高价值的筛法是「**作者已在库、书名却是陌生的**」——
 * 它直接对上用户的目标「尽量每个作者弄全」，而且精度高：
 * 库内 300 余位作者的姓名不会是巧合撞上的。
 *
 * 用法：
 *   node scripts/dd-gap-scan.mjs _dd/cat-all.tsv [--out _dd/gap-candidates.tsv]
 */
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { authorOf, leadTitle } from './lib/dd-title.mjs';

const file = process.argv[2];
if (!file) {
  console.error('用法: node scripts/dd-gap-scan.mjs <当当当分类枚举TSV> [--out 输出]');
  process.exit(1);
}
const outIdx = process.argv.indexOf('--out');
const outFile = outIdx >= 0 ? process.argv[outIdx + 1] : '';

/** 去掉国别标记、著作方式、括注，留下人名 */
export function normAuthor(raw) {
  let s = String(raw)
    .replace(/\[[^\]]{0,4}\]/g, '')
    .replace(/[（(][^）)]{0,6}[）)]/g, '')
    .replace(/\s+/g, '')
    .replace(/[著编译编注校订等著]$/g, '');
  // 「A, B 著」「A B 著」这类多作者只取第一位
  s = s.split(/[,，、]/)[0];
  // 有的行把译者并进来：「詹姆斯·亚飞著郭垚飞译」
  const m = s.match(/^([^著编译]{1,12}?)(?=著|译|编|$)/);
  return (m ? m[1] : s).trim();
}

/** 书名归一：去括注、去空白，用于比对 */
export const normTitle = (s) =>
  String(s)
    .replace(/[（(【\[][^）)】\]]{0,20}[）)】\]]/g, '')
    .replace(/[\s:：·・、,，.。!！?？'"“”‘’—-]/g, '')
    .trim();

// ---- 载入库内作者与书名 ----
const DIR = 'data/books';
const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const authors = new Set();
const titles = new Set();
const authorCount = new Map();
for (const f of files) {
  for (const b of JSON.parse(readFileSync(path.join(DIR, f), 'utf8'))) {
    if (b.author) {
      authors.add(b.author);
      authorCount.set(b.author, (authorCount.get(b.author) ?? 0) + 1);
    }
    if (b.title) titles.add(normTitle(b.title));
    for (const t of b.alternateTitles ?? []) titles.add(normTitle(t));
  }
}
console.log(`库内 ${authors.size} 位作者、${titles.size} 个书名（含又名）`);

// ---- 扫候选 ----
const rows = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
const hits = [];
const seen = new Set();
for (const line of rows) {
  const [id, rawTitle, authorLine, detail] = line.split('\t');
  const a = normAuthor(authorOf(authorLine));
  if (!a || !authors.has(a)) continue;
  const t = leadTitle(rawTitle);
  const nt = normTitle(t);
  if (!nt || titles.has(nt)) continue;
  if (seen.has(nt)) continue;
  seen.add(nt);
  hits.push({ id, author: a, title: t, inLib: authorCount.get(a), detail: (detail ?? '').slice(0, 120) });
}

hits.sort((x, y) => y.inLib - x.inLib || x.author.localeCompare(y.author, 'zh'));
console.log(`\n扫过 ${rows.length} 条候选，命中「库内作者的陌生书名」 ${hits.length} 条\n`);
const byAuthor = new Map();
for (const h of hits) byAuthor.set(h.author, (byAuthor.get(h.author) ?? 0) + 1);
console.log('按作者聚合（库内部数 ↓）：');
for (const [a, n] of [...byAuthor.entries()].sort((x, y) => authorCount.get(y[0]) - authorCount.get(x[0])).slice(0, 40)) {
  console.log(`  ${a}\t库内 ${authorCount.get(a)} 部\t候选 ${n} 条`);
}
console.log('\n前 30 条候选：');
for (const h of hits.slice(0, 30)) console.log(`  [${h.author}｜库内${h.inLib}] ${h.title}  (${h.id})`);

if (outFile) {
  appendFileSync(outFile, hits.map((h) => [h.author, h.title, h.id, h.detail].join('\t')).join('\n') + '\n', 'utf8');
  console.log(`\n已写入 ${outFile}`);
}
