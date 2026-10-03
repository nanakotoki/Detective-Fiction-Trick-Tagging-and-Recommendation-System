#!/usr/bin/env node
/**
 * 前端封面清单生成（第 166 轮新增）
 * ================================
 * `data/covers.json` 是**给人看的**封面台账（含来源条目、同版判据、复核线索）；
 * 前端要的只有三件事：**这部书有没有封面**、**文件叫什么**、**这张图是谁给的**。
 *
 * 于是这个脚本把台账压成 `web/js/core/covers.js`（与 `seed-files.js` 同一套做法：
 * 由脚本生成、文件头写明「请勿手工编辑」，新数据进来重跑一次即可）。
 *
 * 为什么不让页面直接 `<img src="covers/xxx.webp">` 再靠 `onerror` 兜底：
 *   · 全库三千余部里总有几百部没有封面，**每次翻页都打一串 404**，控制台一片红；
 *   · 有清单才能「没有封面就直接画占位块」，不产生任何失败请求。
 *
 * 用法：node scripts/gen-cover-manifest.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INDEX_FILE = path.join(ROOT, 'data', 'covers.json');
const COVERS_DIR = path.join(ROOT, 'web', 'covers');
const OUT_FILE = path.join(ROOT, 'web', 'js', 'core', 'covers.js');

const books = [];
for (const file of fs.readdirSync(path.join(ROOT, 'data', 'books')).filter((f) => f.endsWith('.json') && !f.startsWith('_'))) {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'books', file), 'utf8'));
    if (Array.isArray(list)) for (const b of list) books.push(b);
  } catch {
    /* 坏文件交给 check-data 去报，这里跳过 */
  }
}

let index = { records: {}, misses: {} };
try {
  index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
} catch {
  console.log('  ! 还没有 data/covers.json，先跑 node scripts/fetch-covers.mjs');
}

/**
 * 判据代码：
 *   S=与取评分同一条豆瓣条目（强链接）、I=书号直达（ISBN 与著录一致）、
 *   Y=版本择优·与所收版本同年、N=版本择优·豆瓣上最新的一版、
 *   T=题名＋年份、A=题名前缀＋作者吻合、W=仅题名（弱链接）、P=条目页主图
 */
const MATCH_CODE = {
  'subject-id': 'S',
  'subject-id+page': 'P',
  isbn: 'I',
  'shlib-isbn': 'B',
  weread: 'R',
  'edition-year+title': 'Y',
  'newest+title': 'N',
  'title+year': 'T',
  'title': 'W',
  'prefix+author': 'A',
  'subject-id-miss+title+year': 'T',
  'subject-id-miss+title': 'W',
  'subject-id-miss+prefix+author': 'A',
};

const entries = [];
const aliases = {};
let missingFile = 0;
for (const book of books) {
  const rec = index.records?.[book.id];
  if (!rec?.file) continue;
  if (!fs.existsSync(path.join(COVERS_DIR, rec.file))) {
    missingFile += 1;
    continue;
  }
  const short = rec.file.replace(/^[^.]+\./, '');
  if (short !== 'webp') aliases[book.id] = rec.file;
  // 值格式：条目 id｜该条目出版年｜判据代码（前端用来在详情页写「封面来源」一行）
  const year = String(rec.edition?.year || '').match(/\d{4}/)?.[0] || '';
  entries.push([book.id, `${rec.subjectId || ''}|${year}|${MATCH_CODE[rec.matched] || 'W'}`]);
}

const withCover = entries.length;
const total = books.length;
const bySource = {};
for (const rec of Object.values(index.records || {})) bySource[rec.source || '?'] = (bySource[rec.source || '?'] || 0) + 1;

const lines = [];
lines.push('/**');
lines.push(' * 封面清单 —— **本文件由 scripts/gen-cover-manifest.mjs 自动生成，请勿手工编辑**');
lines.push(' *');
lines.push(` * 生成时间：${new Date().toISOString()}`);
lines.push(` * 覆盖情况：${withCover} / ${total} 部有封面（缺 ${total - withCover} 部，页面用占位图）`);
lines.push(' *');
lines.push(' * 值格式：`条目id|该条目出版年|判据代码`；判据 S=与取评分同一条豆瓣条目（强链接）、');
lines.push(' * I=书号直达（条目页 ISBN 与馆藏著录逐位相同）、B=上图书号→豆瓣直达、P=条目页主图、T=题名＋出版年吻合、');
lines.push(' * Y=版本择优后与所收版本同年、N=版本择优后取豆瓣上最新的一版、');
lines.push(' * A=豆瓣题名是库内题名的前缀且作者吻合（弱链接）、W=仅题名吻合（弱链接）。');
lines.push(' * 图片本地存放在 web/covers/，文件名就是作品 id。');
lines.push(' */');
lines.push('');
lines.push(`export const COVER_STATS = ${JSON.stringify(
  {
    total,
    withCover,
    missing: total - withCover,
    bySource,
    generatedAt: new Date().toISOString(),
  },
  null,
  2
)};`);
lines.push('');
lines.push('/** 非 webp 的封面文件（抓取时该图没有 webp 档，退回 jpg 存了下来） */');
lines.push(`export const COVER_FILE_ALIAS = ${JSON.stringify(aliases, null, 2)};`);
lines.push('');
lines.push('/** id → 「条目id|出版年|判据」 */');
lines.push('const COVER_ENTRIES = {');
for (const [id, meta] of entries) lines.push(`  ${JSON.stringify(id)}: ${JSON.stringify(meta)},`);
lines.push('};');
lines.push('');
lines.push('const COVER_DIR = new URL("../../covers/", import.meta.url);');
lines.push('');
lines.push('/** 这部作品有没有本地封面 */');
lines.push('export function hasCover(id) {');
lines.push('  return Object.prototype.hasOwnProperty.call(COVER_ENTRIES, String(id));');
lines.push('}');
lines.push('');
lines.push('/** 本地封面地址；没有封面时返回空串（调用方画占位块，不要产生 404 请求） */');
lines.push('export function coverUrl(id) {');
lines.push('  const key = String(id);');
lines.push('  if (!hasCover(key)) return "";');
lines.push('  const file = COVER_FILE_ALIAS[key] || key + ".webp";');
lines.push('  return new URL(file, COVER_DIR).href;');
lines.push('}');
lines.push('');
lines.push('/** 封面出处（供详情页写「封面来源」一行）；没有封面时返回 null */');
lines.push('export function coverCredit(id) {');
lines.push('  const meta = COVER_ENTRIES[String(id)];');
lines.push('  if (!meta) return null;');
lines.push('  const [subjectId, year, code] = String(meta).split("|");');
lines.push('  const how = { S: "与本书评分取自同一条豆瓣条目", I: "豆瓣条目页 ISBN 与馆藏著录逐位相同", B: "上图书号 → 豆瓣条目页直达（ISBN 与所查一致）", P: "豆瓣条目页主图", T: "豆瓣题名与出版年均吻合", Y: "版本择优：与所收版本同年的一版", N: "版本择优：豆瓣上最新的一版", R: "微信读书：题名与作者都吻合（豆瓣条目页当时不可用）", A: "豆瓣题名是库内题名的前缀，且作者吻合（弱链接，副题被省）", W: "仅豆瓣题名吻合（弱链接）" }[code] || "豆瓣";');
lines.push('  return { subjectId, year, code, how, url: subjectId ? "https://book.douban.com/subject/" + subjectId + "/" : "" };');
lines.push('}');
lines.push('');
lines.push('/** 全库统一占位图 */');
lines.push('export const COVER_PLACEHOLDER = new URL("_placeholder.svg", COVER_DIR).href;');
lines.push('');

fs.writeFileSync(OUT_FILE, lines.join('\n'), 'utf8');
console.log(`  ✓ 已写出 ${path.relative(ROOT, OUT_FILE)}`);
console.log(`    有封面 ${withCover} / ${total} 部（缺 ${total - withCover}）；来源分布 ${JSON.stringify(bySource)}`);
if (missingFile) console.log(`  ! 台账里有 ${missingFile} 条指向的图片文件不在磁盘上（跑 check-covers 看详情）`);

/* ------------------------------------------------------------------ */
/* 多版本清单（data/covers-editions.json，第 169 轮）                   */
/* ------------------------------------------------------------------ */

/**
 * 「版本一览」要的是**每部作品有哪些版本、每版的出版年与出版社**。
 *
 * 单独放一个文件、由档案页**按需 fetch**，而不是塞进 `covers.js`：
 * 每部最多 3 个版本、3154 部，编进启动就加载的模块里会白白多几百 KB，
 * 而多数页面（知识库列表、标签页）根本用不到它。
 */
const editionBooks = {};
let editionTotal = 0;
for (const book of books) {
  const rec = index.records?.[book.id];
  if (!rec?.editions?.length) continue;
  const list = rec.editions
    .filter((e) => (e?.remote ? Boolean(e.pic) : Boolean(e?.file) && fs.existsSync(path.join(COVERS_DIR, e.file))))
    .map((e) => ({
      subjectId: e.subjectId || '',
      year: e.year || '',
      publisher: e.publisher || '',
      ...(e.translator ? { translator: e.translator } : {}),
      title: e.title || book.title,
      ...(e.remote ? { remote: true, source: e.source || '微信读书', pic: e.pic, largePic: e.largePic || '' } : { file: e.file }),
      primary: Boolean(e.primary),
      collected: Boolean(e.collected),
      // 豆瓣原图地址（前端「看大图」时把 s 档换成 l 档按需加载，失败就退回本地这张）
      ...(!e.remote && e.pic ? { pic: e.pic } : {}),
    }));
  if (!list.length) continue;
  editionBooks[book.id] = list;
  editionTotal += list.length;
}
const editionsFile = path.join(ROOT, 'data', 'covers-editions.json');
fs.writeFileSync(
  editionsFile,
  `${JSON.stringify(
    {
      format: 'detective-fiction-cover-editions',
      version: 1,
      note:
        '封面版本一览：每部作品保存了哪几个版本的封面（最多 3 个）、各自的出版年与出版社。' +
        'file 是 web/covers/ 下的文件名；primary＝外面（书卡与档案页大图）显示的那一张，取最新的一版。' +
        '这份文件由 scripts/gen-cover-manifest.mjs 生成，档案页按需加载。',
      generatedAt: new Date().toISOString(),
      bookCount: Object.keys(editionBooks).length,
      editionCount: editionTotal,
      books: editionBooks,
    },
    null,
    1,
  )}\n`,
  'utf8',
);
const multi = Object.values(editionBooks).filter((l) => l.length > 1).length;
console.log(`  ✓ 已写出 ${path.relative(ROOT, editionsFile)}`);
console.log(`    版本记录 ${editionTotal} 条，覆盖 ${Object.keys(editionBooks).length} 部（其中 ${multi} 部有 2 个以上版本）`);
