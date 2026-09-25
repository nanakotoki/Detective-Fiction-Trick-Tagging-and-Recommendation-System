/**
 * 回填 `editionYear`（`backfill-edition-year`）
 * ===========================================
 * **背景**：`editionYear`（所引版本的出版年）是「选项 C」拆字段时新增的，
 * 因此**早期批次（batch-01～batch-120 前后）的 905 部引进作品都只有 `firstPublished`（原作年）
 * 而没有 `editionYear`**。它们的所引版本年其实一直躺在第一个馆的著录里，只是当时没字段可放。
 *
 * **规则从严**（这是「存量加固」，不能把库改坏）：
 *   1. 只处理**引进作品**（`country !== '中国'`）——中文原创按既定规则 `editionYear` 本就留空；
 *   2. 按题名到**第一个馆**（对外经贸）检索，取详情页的出版发行项；
 *   3. **必须作者吻合**才算同一本书——这是 §45.1 记下的教训：
 *      只按题名跨馆比对会大量命中同名异书（《世界》南派三叔 ↔ 一本「品牌营销」书）；
 *   4. **必须唯一**：命中的多条若给出**不同的年份**，说明该馆藏有多版，无法判断我们引的是哪一版
 *      → **不填**，计入「多版存疑」；
 *   5. 填了就在 `verification.editionYearSource` 里写下**所用的著录原文**，可逐条复核。
 *
 * 默认**预演**，加 `--apply` 才写入。
 */
import { readFileSync, writeFileSync, readdirSync, appendFileSync } from 'node:fs';
import { search, detail } from './lib/uibe.mjs';

const APPLY = process.argv.includes('--apply');
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const DELAY = Number((process.argv.find((a) => a.startsWith('--delay=')) || '').split('=')[1] || 800);
const LOG = '_dd/backfill-edition-year.tsv';

const authorKey = (s) => String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z]/g, '');
function authorMatch(a, b) {
  const x = authorKey(a);
  const y = authorKey(b);
  if (!x || !y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && long.includes(short);
}
/** 从出版发行项里取四位年份（取**最后一个**，因为「北京:,新星出版社:,2019.04」这种格式年份在末尾） */
function yearOf(imprint) {
  const ys = String(imprint || '').match(/(19|20)\d{2}/g);
  return ys ? ys[ys.length - 1] : '';
}

const targets = [];
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  const arr = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  arr.forEach((b, i) => {
    if (b.editionYear) return;
    if (!b.country || b.country === '中国') return;
    targets.push({ file: f, index: i, book: b });
  });
}
console.log(`引进作品缺 editionYear：${targets.length} 部${LIMIT ? `（本次只处理前 ${LIMIT} 部）` : ''}\n`);

const todo = LIMIT ? targets.slice(0, LIMIT) : targets;
const stats = { filled: 0, ambiguous: 0, notFound: 0, noYear: 0 };
const dirty = new Map();

for (const t of todo) {
  const b = t.book;
  let verdict = '';
  let year = '';
  let evidence = '';
  try {
    const res = await search(b.title, { site: 'uibe' });
    const hits = res.rows.filter((r) => authorMatch(b.author, r.author));
    if (!hits.length) {
      verdict = '未找到作者吻合的著录';
      stats.notFound += 1;
    } else {
      const years = new Set();
      for (const h of hits.slice(0, 4)) {
        await new Promise((r) => setTimeout(r, DELAY));
        try {
          const d = await detail(h.bookId, { site: 'uibe' });
          const y = yearOf(d.imprint);
          if (y) {
            years.add(y);
            if (!evidence) evidence = `${d.imprint}（${b.title}／${h.author}）`;
          }
        } catch {
          /* 单条失败继续 */
        }
      }
      if (years.size === 1) {
        year = [...years][0];
        verdict = '唯一匹配，已定';
        stats.filled += 1;
      } else if (years.size === 0) {
        verdict = '著录无出版年';
        stats.noYear += 1;
      } else {
        verdict = `该馆有多版（${[...years].join('/')}），无法判断所引版本`;
        stats.ambiguous += 1;
      }
    }
  } catch (e) {
    verdict = `检索失败：${e.message}`;
  }
  appendFileSync(LOG, [b.id, b.title, b.author, year, verdict, evidence].join('\t') + '\n', 'utf8');
  if (year && APPLY) {
    b.editionYear = year;
    b.verification = b.verification || {};
    b.verification.editionYearSource = `**对外经贸大学图书馆 OPAC 著录**：${evidence}。本条 ` + '`editionYear` 由 `scripts/backfill-edition-year.mjs` 按「作者吻合且该馆仅此一版」的规则回填（2026-09）。';
    if (!dirty.has(t.file)) dirty.set(t.file, JSON.parse(readFileSync(`data/books/${t.file}`, 'utf8')));
    dirty.get(t.file)[t.index] = b;
  }
  console.log(`${year ? '✓' : '·'} 《${b.title}》 ${b.author} → ${year || '（不填）'} ${verdict}`);
  // **定期落盘**：全量 900 多部要跑二三十分钟，中途中断不能让已定的白跑。
  if (APPLY && stats.filled % 25 === 0 && dirty.size) {
    for (const [file, arr] of dirty) writeFileSync(`data/books/${file}`, JSON.stringify(arr, null, 2) + '\n', 'utf8');
    dirty.clear();
  }
  await new Promise((r) => setTimeout(r, DELAY));
}

if (APPLY) {
  for (const [file, arr] of dirty) writeFileSync(`data/books/${file}`, JSON.stringify(arr, null, 2) + '\n', 'utf8');
  console.log(`\n已写入 ${dirty.size} 个文件。`);
}
console.log(`\n统计：已定 ${stats.filled} / 多版存疑 ${stats.ambiguous} / 无出版年 ${stats.noYear} / 未找到 ${stats.notFound}`);
console.log(`明细写入 ${LOG}`);
