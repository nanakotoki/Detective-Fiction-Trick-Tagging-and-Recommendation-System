/**
 * 比对「上图按作者枚举」结果与知识库（`shlib-diff`）
 * ==============================================
 * 输入 `_dd/shlib-author.tsv`（`shlib-author-scan.mjs` 的产物），输出：
 *   1. **库内没有的题名**，按「判据强度」分档——
 *      ① 主题词含「推理小说／侦探小说」 → 最硬，可直接进候选队列；
 *      ② 中图法含 `.456` 复分号 → 同为最硬；
 *      ③ 两者都没有 → 只列为「待查」，**不入候选**（§48.1 的纪律）。
 *   2. **库内已有但版本年不同**的记录 → 供 `editionYear` 复核（不改数据，只列）。
 *   3. 作者维度的缺口统计（每位作者：上图有几部、库内几部、还差几部）。
 *
 * 用法：node scripts/shlib-diff.mjs [--in _dd/shlib-author.tsv] [--out _dd/shlib-gap.tsv]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
/**
 * 支持**多份扫描结果合并**：一轮全量（`shlib-author.tsv`）+ 二轮补扫
 * （`shlib-author2.tsv`，把被 `--max` 截断的大作者扫深）。
 * `--in a.tsv --in b.tsv` 或 `--in a.tsv,b.tsv` 都行；第二轮同名作者的行会覆盖第一轮的。
 */
const IN = argv.reduce((acc, a, i) => (a === '--in' ? [...acc, argv[i + 1]] : acc), []);
const IN_FILES = (IN.length ? IN : ['_dd/shlib-author.tsv']).flatMap((s) => String(s).split(','));
const OUT = arg('--out', '_dd/shlib-gap.tsv');
// ── 知识库 ─────────────────────────────────────────────────────────
const books = [];
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  const j = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  for (const b of Array.isArray(j) ? j : j.books || []) books.push({ ...b, _file: f });
}
const norm = (s) =>
  String(s || '')
    .replace(/[\s:：·・,，.。()（）[\]【】\-—_/、；;！!？?]/g, '')
    .replace(/第[一二三四五六七八九十\d]+[部卷册季集]/g, '')
    .toLowerCase();
const byTitle = new Map();
for (const b of books) {
  byTitle.set(norm(b.title), b);
  for (const a of b.alternateTitles || []) byTitle.set(norm(a), b);
}
/** 去副题名：`水魑·沉没之物` vs `水魑の如き沈むもの` 这类要靠卷次/骨架，此处只做「正题名首段」 */
const coreTitle = (t) => norm(String(t || '').split(/[:：·・,，(（]/)[0]);

const rows = IN_FILES.flatMap((f) =>
  readFileSync(f, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split('\t')),
);
/** 第二轮补扫过的作者：其在第一轮的行作废，避免同一本书重复计数 */
const rescanned = new Set(
  IN_FILES.slice(1).flatMap((f) =>
    readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => l.split('\t'))
      .filter((c) => c[1] === '__DONE__')
      .map((c) => c[0]),
  ),
);
const firstFiles = new Set(IN_FILES.slice(0, 1));
const rowsFiltered = IN_FILES.flatMap((f, idx) =>
  readFileSync(f, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split('\t'))
    .filter((c) => (idx === 0 && firstFiles.has(f) && rescanned.has(c[0]) ? false : true)),
);
const allRows = rowsFiltered;
const doneRows = allRows.filter((c) => c[1] === '__DONE__');
const dataRows = allRows.filter((c) => c[1] !== '__DONE__');
for (const f of IN_FILES) console.log(`读入 ${f}：${readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).length} 行`);
if (rescanned.size) console.log(`其中 ${rescanned.size} 位作者以二轮补扫结果为准`);

/** 被 `--max` 截断的作者：上图著录数 > 实际取回数 */
const truncated = doneRows
  .filter((c) => Number(c[2] || 0) > Number(c[3] || 0))
  .map((c) => ({ author: c[0], count: Number(c[2]), got: Number(c[3]) }))
  .sort((a, b) => b.count - a.count);
if (truncated.length) {
  console.log(`\n⚠️ 被 --max 截断的作者 ${truncated.length} 位（需二轮补扫）：`);
  for (const t of truncated.slice(0, 15)) console.log(`   ${t.author}：上图 ${t.count} 条，只取回 ${t.got} 条`);
}

const MYSTERY_SUBJ = /推理小说|侦探小说/;
const MYSTERY_CLC = /\.456/;

const gaps = [];
const yearDiffs = [];
const perAuthor = new Map();

for (const c of allRows.filter((x) => x[1] !== '__DONE__')) {
  const [author, title, primary, authorsAll, clc, year, publisher, subjects, series, isbn, id] = c;
  perAuthor.set(author, (perAuthor.get(author) || 0) + 1);

  const key = norm(title);
  const core = coreTitle(title);
  const hit = byTitle.get(key) || (core.length >= 4 ? byTitle.get(core) : null);
  if (hit) {
    if (hit.editionYear && year && String(hit.editionYear) !== String(year)) {
      yearDiffs.push({ author, title, ours: hit.editionYear, shlib: year, oursTitle: hit.title, id });
    }
    continue;
  }
  const strong = MYSTERY_SUBJ.test(subjects) || MYSTERY_CLC.test(clc);
  gaps.push({ author, title, primary, authorsAll, clc, year, publisher, subjects, series, isbn, id, strong });
}

const strongGaps = gaps.filter((g) => g.strong);
const weakGaps = gaps.filter((g) => !g.strong);
writeFileSync(
  OUT,
  [
    '判据\t查询作者\t题名\t责任者\t中图法\t版本年\t出版者\t主题词\t丛编\tISBN\t馆藏id',
    ...[...strongGaps, ...weakGaps].map((g) =>
      [g.strong ? '硬判据' : '待查', g.author, g.title, g.primary, g.clc, g.year, g.publisher, g.subjects, g.series, g.isbn, g.id].join('\t'),
    ),
  ].join('\n') + '\n',
  'utf8',
);

const totalRows = allRows.filter((c) => c[1] !== '__DONE__').length;
console.log(`比对 ${totalRows} 行（${perAuthor.size} 位作者）`);
console.log(`  库内已有          ${totalRows - gaps.length}`);
console.log(`  缺口·硬判据（可收）${strongGaps.length}`);
console.log(`  缺口·待查（不收）  ${weakGaps.length}`);
console.log(`  版本年不同（仅列出）${yearDiffs.length}`);
console.log(`\n写入 ${OUT}`);

const byAuthor = new Map();
for (const g of strongGaps) (byAuthor.get(g.author) || byAuthor.set(g.author, []).get(g.author)).push(g);
const top = [...byAuthor.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 25);
if (top.length) {
  console.log('\n硬判据缺口最多的作者：');
  for (const [a, list] of top) console.log(`  ${String(list.length).padStart(3)} 部  ${a}`);
}

if (process.argv.includes('--list')) {
  console.log('\n=== 硬判据缺口明细 ===');
  for (const g of strongGaps) {
    console.log(`  ${g.author} ｜ ${g.title} ｜ ${g.primary} ｜ ${g.clc} ｜ ${g.year} ｜ ${g.publisher} ｜ ${g.subjects.slice(0, 40)}`);
  }
}
