/**
 * 复核 `editionYear` 回填（`audit-edition-year`）
 * ==============================================
 * **为什么必须复核**：`backfill-edition-year.mjs` 用「作者吻合」判定同一本书，
 * 但事后探测发现**第一个馆的题名检索其实是宽松字面匹配**：
 *
 *   · 查《犬神家一族》返回的是《李小龙:生活的艺术家》《古希腊的传说和神话》…（23696 条）
 *   · 查《独眼少女》返回的是《少女抒情诗》《死亡与少女》…（126 条）
 *
 * 也就是说 `search(书名)` **不能保证第 1 页里就有这本书**。回填只按作者过滤，
 * 于是「同一位作者的**另一本书**」也可能被当成命中，把它的版本年填到这本书上。
 * 那 224 条「唯一匹配，已定」必须逐条回查：**题名也要对得上，才算证据。**
 *
 * 本工具对每条已回填的书重新检索，要求**作者与题名同时吻合**，再看年份：
 *   · `ok`         —— 题名吻合的著录里含所填年份；
 *   · `mismatch`   —— 题名吻合，但年份对不上（**填错了，要改**）；
 *   · `unverified` —— 题名吻合的著录一条都没检索到（馆里查不到这本，原填缺乏依据）；
 *   · `noTitle`    —— 只按作者能命中，题名全不吻合（**很可能是同作者的另一本书**）。
 *
 * 只读，不写数据。用法：
 *   node scripts/audit-edition-year.mjs [--limit N] [--delay 900] [--out _dd/edition-year-audit.tsv]
 */
import { readFileSync, readdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { search, detail } from './lib/uibe.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const LIMIT = Number(arg('--limit', '0'));
const DELAY = Number(arg('--delay', '900'));
const OUT = arg('--out', '_dd/edition-year-audit.tsv');

const authorKey = (s) => String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z]/g, '');
function authorMatch(a, b) {
  const x = authorKey(a);
  const y = authorKey(b);
  if (!x || !y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && long.includes(short);
}

/** 题名归一：去标点空白、去卷次 */
const norm = (s) =>
  String(s || '')
    .replace(/[\s:：·・,，.。()（）[\]【】\-—_/、；;]/g, '')
    .replace(/第[一二三四五六七八九十\d]+[部卷册季集]/g, '');
/**
 * 题名吻合判定：**短题名必须完全相等**，长题名才允许包含关系。
 * 理由：《帷幕》《鸦》这类两字书名做包含判定会大面积误命中。
 */
function titleMatch(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < 4) return false;
  return long.includes(short);
}
/** 从出版发行项里取四位年份（取最后一个） */
const yearOf = (imprint) => {
  const ys = String(imprint || '').match(/(19|20)\d{2}/g);
  return ys ? ys[ys.length - 1] : '';
};

// ── 收集已回填的条目 ───────────────────────────────────────────────
const targets = [];
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  const arr = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  if (!Array.isArray(arr)) continue;
  for (const b of arr) {
    if (b.editionYear && b.verification?.editionYearSource) targets.push({ file: f, book: b });
  }
}
console.log(`带来源的 editionYear 条目 ${targets.length} 条${LIMIT ? `（本次查前 ${LIMIT} 条）` : ''}\n`);
const todo = LIMIT ? targets.slice(0, LIMIT) : targets;

if (!existsSync(OUT)) writeFileSync(OUT, '', 'utf8');
const done = new Set(
  existsSync(OUT)
    ? readFileSync(OUT, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => l.split('\t')[0])
    : [],
);

const stats = { ok: 0, mismatch: 0, unverified: 0, noTitle: 0, error: 0 };
for (const t of todo) {
  const b = t.book;
  if (done.has(b.id)) continue;
  let verdict = 'error';
  let note = '';
  try {
    const res = await search(b.title, { site: 'uibe' });
    const byAuthor = res.rows.filter((r) => authorMatch(b.author, r.author));
    const byTitle = byAuthor.filter((r) => titleMatch(b.title, r.title));
    if (!byTitle.length) {
      verdict = byAuthor.length ? 'noTitle' : 'unverified';
      note = byAuthor.length
        ? `仅作者吻合的行：${byAuthor.slice(0, 3).map((r) => `${r.title}／${r.publisher}`).join(' | ')}`
        : '该馆题名检索无作者吻合行';
    } else {
      const years = new Set();
      for (const h of byTitle.slice(0, 4)) {
        await new Promise((r) => setTimeout(r, DELAY));
        try {
          const y = yearOf((await detail(h.bookId, { site: 'uibe' })).imprint);
          if (y) years.add(y);
        } catch {
          /* 单条失败继续 */
        }
      }
      note = `题名吻合 ${byTitle.length} 条，年份：${[...years].join('/') || '无'}`;
      verdict = years.has(String(b.editionYear)) ? 'ok' : 'mismatch';
      if (verdict === 'mismatch' && !years.size) verdict = 'unverified';
    }
  } catch (e) {
    note = `检索失败：${e.message}`;
  }
  stats[verdict] = (stats[verdict] || 0) + 1;
  appendFileSync(OUT, [b.id, b.title, b.author, b.editionYear, verdict, note].join('\t') + '\n', 'utf8');
  const mark = verdict === 'ok' ? '✓' : verdict === 'mismatch' ? '✗' : '·';
  console.log(`${mark} ${verdict.padEnd(10)} 《${b.title}》 ${b.author} 填 ${b.editionYear} — ${note}`);
  await new Promise((r) => setTimeout(r, DELAY));
}
console.log(
  `\n统计：吻合 ${stats.ok} / 年份对不上 ${stats.mismatch} / 查不到按题名吻合的著录 ${stats.unverified} / 只作者吻合 ${stats.noTitle} / 失败 ${stats.error}`,
);
console.log(`明细写入 ${OUT}`);
