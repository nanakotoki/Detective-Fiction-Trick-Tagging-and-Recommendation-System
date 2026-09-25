/**
 * 候选补提要（两馆并查）——`shlib-blurb2`
 * ======================================
 * 给一批已知书名逐个去**两个馆**取编目提要：
 *   ① 第一个馆（对外经贸）：题名检索 + 详情页（题名检索只用于**验证已知书名**，见 §58.2）；
 *   ② 第二个馆（重庆工商大学）：关键词检索「命中题名的行」+ 详情页。
 * 只取**提要／丛编／中图法／出版项／主题词**，写 TSV 供人工改写无剧透梗概。**不写数据。**
 *
 * ⚠️ **必须同时校验作者**（第 67 轮加）：只按题名匹配时，捞到的 30 条里有 25 条是同名异书
 * （《三只眼睛》命中经济书、《千钧一发》命中英语教材）。
 *
 * 用法：
 *   node scripts/shlib-blurb2.mjs --file _dd/no-abs-titles.txt --out _dd/blurbs2.tsv [--delay 500] [--limit 50]
 * 断点续跑：已在 out 里的书名跳过；候选作者表默认读 `_dd/no-abs.tsv`。
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { search, detail, SITES, get, parseList } from './lib/uibe.mjs';

const argv = process.argv.slice(2);
/** 带值的选项必须先消费掉它的值，否则 `--out x.tsv` 里的 `x.tsv` 会被当成书名 */
const OPTS_WITH_VALUE = new Set(['--out', '--delay', '--limit', '--file', '--authors-file']);
const positionals = [];
const opts = {};
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (OPTS_WITH_VALUE.has(a)) {
    opts[a] = argv[i + 1];
    i += 1;
  } else if (a.startsWith('--')) {
    opts[a] = true;
  } else {
    positionals.push(a);
  }
}
const OUT = opts['--out'] || '_dd/blurbs2.tsv';
const DELAY = Number(opts['--delay'] || '700');
const LIMIT = Number(opts['--limit'] || '0');

let titles = positionals.slice();
if (opts['--file']) {
  titles = readFileSync(opts['--file'], 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
if (LIMIT) titles = titles.slice(0, LIMIT);

const norm = (s) =>
  String(s || '')
    .replace(/[\s:：·・,，.。()（）[\]【】\-—_/、；;！!？?「」『』"']/g, '')
    .toLowerCase();

/** 作者串归一：去括号内容 → 去标点 → 剥责任方式（可出现在任意位置） */
const normAuthor = (s) =>
  norm(s)
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[，,、；;。.]/g, '')
    .replace(/(编著|主编|著|编|译|绘|等)/g, '');

const authorOk = (want, got) => {
  const a = normAuthor(want);
  const b = normAuthor(got);
  if (!a || !b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 2 && long.includes(short);
};

/** 题名吻合：完全相等，或（短边 ≥4 字时）一方包含另一方 */
const titleHit = (want, got) => {
  const a = norm(want);
  const b = norm(got);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.includes(short);
};

const done = new Set();
if (existsSync(OUT)) {
  for (const l of readFileSync(OUT, 'utf8').split(/\r?\n/)) if (l.trim()) done.add(l.split('\t')[0]);
}
console.log(`待补提要 ${titles.length} 个书名（已处理 ${done.size}）→ ${OUT}\n`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 第二个馆：关键词检索，找题名吻合的行，再取详情 */
async function fromCtbu(title, wantAuthor = '') {
  const s = SITES.ctbu;
  const html = await get(`${s.base}${s.path}?q=${encodeURIComponent(title)}`);
  const rows = parseList(html, 'ctbu');
  const hit = rows.find((r) => titleHit(title, r.title) && (!wantAuthor || authorOk(wantAuthor, r.author)));
  if (!hit) return null;
  await sleep(DELAY);
  const d = await detail(hit.bookId, { site: 'ctbu' });
  return {
    site: 'ctbu',
    gotTitle: hit.title,
    author: d.author || hit.author || '',
    imprint: d.imprint || hit.publisher || '',
    clc: d.clc || '',
    subjects: (d.subjects || '').replace(/&nbsp;/g, ' ').trim(),
    series: d.series || '',
    abstract: (d.abstract || '').replace(/\s+/g, ' ').trim(),
    id: hit.bookId,
  };
}

/** 第一个馆：题名检索 + 详情 */
async function fromUibe(title, wantAuthor = '') {
  const res = await search(title, { site: 'uibe' });
  const hit = res.rows.find((r) => titleHit(title, r.title) && (!wantAuthor || authorOk(wantAuthor, r.author)));
  if (!hit) return null;
  await sleep(DELAY);
  const d = await detail(hit.bookId, { site: 'uibe' });
  return {
    site: 'uibe',
    gotTitle: hit.title,
    author: hit.author || '',
    imprint: d.imprint || '',
    clc: d.clc || '',
    subjects: (d.subjects || '').replace(/&nbsp;/g, ' ').trim(),
    series: d.series || '',
    abstract: (d.abstract || '').replace(/\s+/g, ' ').trim(),
    id: hit.bookId,
  };
}

/**
 * 候选作者表：`_dd/no-abs.tsv` 的第一列是作者、第二列是题名。
 * **必须带作者去查**——第 67 轮复核发现，只按题名匹配时捞到的 30 条里
 * 有 25 条是同名异书（《三只眼睛》命中经济书、《千钧一发》命中英语教材…）。
 */
const wantAuthorOf = new Map();
{
  const af = opts['--authors-file'] || '_dd/no-abs.tsv';
  if (existsSync(af)) {
    for (const line of readFileSync(af, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const c = line.split('\t');
      if (c[0] && c[1]) wantAuthorOf.set(c[1], c[0]);
    }
  }
  console.log(`候选作者表：${wantAuthorOf.size} 条`);
}

let ok = 0;
let empty = 0;
let miss = 0;
for (const title of titles) {
  const wantAuthor = wantAuthorOf.get(title) || '';
  if (done.has(title)) continue;
  let rec = { site: '', gotTitle: '', author: '', imprint: '', clc: '', subjects: '', series: '', abstract: '', id: '' };
  let note = '';
  try {
    const a = await fromUibe(title, wantAuthor).catch(() => null);
    if (a?.abstract) rec = a;
    else {
      await sleep(DELAY);
      const b = await fromCtbu(title, wantAuthor).catch(() => null);
      if (b?.abstract) rec = b;
      else if (a || b) {
        rec = a || b;
        note = '两馆均无提要';
      } else note = '两馆均未命中题名（或作者不吻合）';
    }
  } catch (e) {
    note = `失败：${e.message}`;
  }
  if (rec.abstract) ok += 1;
  else if (note === '两馆均无提要') empty += 1;
  else miss += 1;
  appendFileSync(
    OUT,
    [title, rec.site, rec.gotTitle, rec.author, rec.imprint, rec.clc, rec.subjects, rec.series, rec.abstract, note].join('\t') + '\n',
    'utf8',
  );
  console.log(
    `${rec.abstract ? '✓' : '·'} ${title} ｜ ${rec.site || '—'} ｜ ${rec.imprint || '—'} ｜ ${rec.abstract ? rec.abstract.slice(0, 60) + '…' : note}`,
  );
  await sleep(DELAY);
}
console.log(`\n有提要 ${ok} ／ 无提要 ${empty} ／ 未命中 ${miss}　→ ${OUT}`);
