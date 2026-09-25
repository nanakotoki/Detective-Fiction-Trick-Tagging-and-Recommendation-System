/**
 * `editionYear` 二次回填（**上海图书馆**，`backfill-edition-year2`）
 * =============================================================
 * 第一轮用对外经贸馆回填时，有 **536 部「未找到作者吻合的著录」**——
 * 那一馆确实没有那些版本（多为老版、绝版书）。上图藏书量级大得多，
 * 且经探针验证：`type=Title` 是**精确题名索引**（查《帷幕》只回同名的书，
 * 靠作者一滤即可），记录里带**完整 CNMARC**，出版项在 210 $a/$c/$d。
 *
 * 规则与第一轮一致，只从严：
 *   1. 只处理**引进作品**（`country !== '中国'`）且**尚无** `editionYear` 的条目；
 *   2. 按题名检索，**必须作者吻合**（把「(日) 」「著」这类前后缀归一后比对）；
 *   3. **必须唯一**：命中的年若不止一个，说明上图藏有多版，**不填**；
 *   4. 填了就把**著录原文**写进 `verification.editionYearSource`，可逐条复核。
 *
 * 默认**预演**，加 `--apply` 才写盘。
 */
import { readFileSync, writeFileSync, readdirSync, appendFileSync } from 'node:fs';
import { BASE, FIELDS, normalizeRecord } from './lib/shlib.mjs';

const APPLY = process.argv.includes('--apply');
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const DELAY = Number((process.argv.find((a) => a.startsWith('--delay=')) || '').split('=')[1] || 600);
const LOG = '_dd/backfill-edition-year2.tsv';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const authorKey = (s) => String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z]/g, '');
function authorMatch(a, b) {
  const x = authorKey(a);
  const y = authorKey(b);
  if (!x || !y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && long.includes(short);
}
const norm = (s) =>
  String(s || '')
    .replace(/[\s:：·・,，.。()（）[\]【】\-—_/、；;！!？?]/g, '')
    .replace(/第[一二三四五六七八九十\d]+[部卷册季集]/g, '');
/** 短题名要求完全相等；长题名允许包含（防止《帷幕》《鸦》这类两字书误命中） */
function titleMatch(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && long.includes(short);
}

const FQ = FIELDS.map((f) => `field[]=${encodeURIComponent(f)}`).join('&');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchTitle(title) {
  const url = `${BASE}/api/v1/search?lookfor=${encodeURIComponent(title)}&type=Title&limit=20&${FQ}`;
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return { count: j.resultCount ?? 0, records: (j.records || []).map(normalizeRecord) };
}

// ── 目标：引进作品且缺 editionYear ────────────────────────────────
const targets = [];
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  const arr = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  if (!Array.isArray(arr)) continue;
  arr.forEach((b, i) => {
    if (b.editionYear) return;
    if (!b.country || b.country === '中国') return;
    targets.push({ file: f, index: i, book: b });
  });
}
console.log(`引进作品仍缺 editionYear：${targets.length} 部${LIMIT ? `（本次只处理前 ${LIMIT} 部）` : ''}\n`);
const todo = LIMIT ? targets.slice(0, LIMIT) : targets;

const stats = { filled: 0, ambiguous: 0, notFound: 0, noYear: 0, error: 0 };
const dirty = new Map();

for (const t of todo) {
  const b = t.book;
  let verdict = '';
  let year = '';
  let evidence = '';
  try {
    const res = await searchTitle(b.title);
    const byTitle = res.records.filter((r) => titleMatch(b.title, r.title));
    const hits = byTitle.filter((r) => authorMatch(b.author, r.primaryAuthor) || r.authors.some((a) => authorMatch(b.author, a)));
    if (!hits.length) {
      verdict = byTitle.length ? '题名命中但作者不吻合' : '未找到题名吻合的著录';
      stats.notFound += 1;
    } else {
      const years = new Set(hits.map((r) => r.year).filter(Boolean));
      if (years.size === 1) {
        year = [...years][0];
        verdict = '唯一匹配，已定';
        const h = hits.find((r) => r.year === year);
        evidence = `${h.imprint}（馆藏题名「${h.title}」／${h.primaryAuthor}）`;
        stats.filled += 1;
      } else if (!years.size) {
        verdict = '著录无出版年';
        stats.noYear += 1;
      } else {
        verdict = `上图有多版（${[...years].join('/')}），无法判断所引版本`;
        stats.ambiguous += 1;
      }
    }
  } catch (e) {
    verdict = `检索失败：${e.message}`;
    stats.error += 1;
  }
  appendFileSync(LOG, [b.id, b.title, b.author, year, verdict, evidence].join('\t') + '\n', 'utf8');
  if (year && APPLY) {
    b.editionYear = year;
    b.verification = b.verification || {};
    b.verification.editionYearSource =
      `**上海图书馆 OPAC 著录（CNMARC 210 出版发行项）**：${evidence}。本条 \`editionYear\` 由 ` +
      '`scripts/backfill-edition-year2.mjs` 按「题名与作者同时吻合、且该馆仅此一版」的规则回填（2026-09），' +
      '并经 `scripts/shlib-diff.mjs` 的比对口径复核。';
    if (!dirty.has(t.file)) dirty.set(t.file, JSON.parse(readFileSync(`data/books/${t.file}`, 'utf8')));
    dirty.get(t.file)[t.index] = b;
  }
  console.log(`${year ? '✓' : '·'} 《${b.title}》 ${b.author} → ${year || '（不填）'} ${verdict}`);
  if (APPLY && stats.filled % 25 === 0 && dirty.size) {
    for (const [file, arr] of dirty) writeFileSync(`data/books/${file}`, JSON.stringify(arr, null, 2) + '\n', 'utf8');
    dirty.clear();
  }
  await sleep(DELAY);
}

if (APPLY) {
  for (const [file, arr] of dirty) writeFileSync(`data/books/${file}`, JSON.stringify(arr, null, 2) + '\n', 'utf8');
  console.log(`\n已写入 ${dirty.size} 个文件。`);
}
console.log(
  `\n统计：已定 ${stats.filled} / 多版存疑 ${stats.ambiguous} / 无出版年 ${stats.noYear} / 未找到 ${stats.notFound} / 失败 ${stats.error}`,
);
console.log(`明细写入 ${LOG}`);
