#!/usr/bin/env node
/**
 * 缺封面的最后一条通道：**上图查书号 → 豆瓣书号直达**（第 177 轮）
 * ==========================================================
 * 背景：全库还剩一批没有封面的书（约 160 部）。它们是**豆瓣与微信读书都没有**的那些：
 * 老译本、地方社的通俗推理、港台旧版……按题名怎么搜都搜不出来。
 *
 * 但「按题名搜不到」不等于「豆瓣没有这一版」——豆瓣的 `subject_suggest` 只是**题名建议索引**，
 * 覆盖不全；而 `book.douban.com/isbn/<isbn>/` 是**按书号直达条目页**的，命中率高得多。
 * 问题只在于：这批书的著录里**没有书号**（实测 254/273 没有）。
 *
 * 于是这条通道分两步：
 *   ① 拿题名去**上海图书馆 OPAC** 查著录，从 CNMARC 里取 ISBN（并核对题名一致）；
 *   ② 用这个书号去豆瓣直达条目页，**核对页面上写的 ISBN 与所查一致**之后才取封面。
 * 空跑实测：这批书里约 50% 能从上图拿到书号（`_dd/probe-missing-isbn.mjs`）。
 *
 * 用法：
 *   node scripts/backfill-isbn-covers.mjs                    干跑：只报告能救回哪些
 *   node scripts/backfill-isbn-covers.mjs --apply            写回（下图 + 更新 data/covers.json）
 *   node scripts/backfill-isbn-covers.mjs --limit 20 --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE, parseMarc, isbnOf } from './lib/shlib.mjs';
import { parseMainPic, parseInfoLite, isDefaultPic, toIsbn13, toWebp, imageSize } from './lib/covers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');
const COVERS_DIR = path.join(ROOT, 'web', 'covers');
const INDEX_FILE = path.join(ROOT, 'data', 'covers.json');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const LIMIT = Number(argv[argv.indexOf('--limit') + 1]) || 0;
const DELAY = Number(argv[argv.indexOf('--delay') + 1]) || 700;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const F = 'field[]=title&field[]=authors&field[]=publishers&field[]=publicationDates&field[]=isbns&field[]=rawData';

const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', green: '\u001b[32m', yellow: '\u001b[33m', red: '\u001b[31m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s || '').replace(/\s+/g, '');
const yearOf = (s) => String(s || '').match(/\d{4}/)?.[0] || '';

/* ---------------- 读数据 ---------------- */

const books = new Map();
for (const f of fs.readdirSync(BOOKS_DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  for (const b of JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, f), 'utf8'))) books.set(b.id, b);
}
const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));

/** 目标 = 「未取到」里那些还没有封面的（抓取脚本的 misses 就是这份名单） */
let targets = Object.entries(index.misses || {})
  .filter(([id]) => !index.records[id])
  .map(([id, m]) => ({ id, ...m, book: books.get(id) }))
  .filter((t) => t.book);
if (LIMIT) targets = targets.slice(0, LIMIT);

console.log('');
console.log(color(`  上图查书号 → 豆瓣书号直达：待处理 ${targets.length} 部${APPLY ? '' : '（干跑）'}`, C.bold));
console.log('');

/* ---------------- 两步走 ---------------- */

/** ① 上图按题名查著录，取书号（要求题名一致） */
async function isbnFromShlib(title, author) {
  const url = `${BASE}/api/v1/search?lookfor=${encodeURIComponent(title)}&type=Title&limit=10&${F}`;
  const json = await (await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } })).json();
  const recs = json?.records || [];
  const want = clean(title);
  const hit = recs.find((r) => {
    const a = clean(r.title);
    return a === want || a.startsWith(want) || want.startsWith(a);
  });
  if (!hit) return { isbns: [], note: `上图 ${recs.length} 条著录里没有题名吻合的` };
  const marc = parseMarc(hit.rawData?.fullrecord || '');
  const isbns = isbnOf(marc).map((x) => x.replace(/[^\dXx]/g, '')).filter((x) => x.length === 13 || x.length === 10);
  return { isbns: [...new Set(isbns)], title: hit.title, note: isbns.length ? '' : '上图著录里没有书号' };
}

/** ② 豆瓣书号直达（核对页面 ISBN 与所查一致），返回封面地址 */
async function coverFromDoubanIsbn(isbn) {
  const res = await fetch(`https://book.douban.com/isbn/${isbn}/`, {
    redirect: 'follow',
    headers: { 'user-agent': UA, referer: 'https://book.douban.com/' },
  });
  if (!res.ok) return { ok: false, note: `豆瓣 HTTP ${res.status}` };
  const html = await res.text();
  const sid = (String(res.url).match(/subject\/(\d+)/) || [])[1] || '';
  if (!sid) return { ok: false, note: '书号没有跳到条目页' };
  const info = parseInfoLite(html);
  if (info.isbn && toIsbn13(info.isbn) !== toIsbn13(isbn)) {
    return { ok: false, note: `跳到的条目 ISBN 是 ${info.isbn}，与本版不一致` };
  }
  const pic = parseMainPic(html);
  if (!pic || isDefaultPic(pic)) return { ok: false, note: '豆瓣该条目没有封面图' };
  return { ok: true, pic, sid, info };
}

/** 下载封面：先试 webp 档，退回 jpg */
async function downloadCover(picUrl) {
  for (const [url, ext] of [
    [toWebp(picUrl), 'webp'],
    [picUrl, 'jpg'],
  ]) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://book.douban.com/' } });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) continue;
      const size = imageSize(buf);
      if (size.format !== 'webp' && size.format !== 'jpeg') continue;
      return { url, ext, buf, ...size, bytes: buf.length };
    } catch {
      /* 换下一档 */
    }
  }
  return null;
}

/* ---------------- 主循环 ---------------- */

let saved = 0;
let noIsbn = 0;
let noCover = 0;
const savedIds = [];

for (const t of targets) {
  const title = t.book.title;
  try {
    await sleep(DELAY);
    const sh = await isbnFromShlib(title, t.book.author);
    if (!sh.isbns.length) {
      noIsbn += 1;
      if (targets.length <= 40) console.log(color(`  · 《${title}》：${sh.note}`, C.dim));
      continue;
    }
    let done = false;
    for (const isbn of sh.isbns.slice(0, 2)) {
      await sleep(DELAY);
      const db = await coverFromDoubanIsbn(isbn);
      if (!db.ok) continue;
      const img = await downloadCover(db.pic);
      if (!img) continue;
      saved += 1;
      savedIds.push(`${t.id}《${title}》← 上图书号 ${isbn} → 豆瓣条目 ${db.sid}（${db.info.year || '年份未标'}）`);
      if (APPLY) {
        const file = `${t.id}.${img.ext}`;
        fs.writeFileSync(path.join(COVERS_DIR, file), img.buf);
        const bookYear = yearOf(t.book.editionYear);
        const entryYear = yearOf(db.info.year);
        index.records[t.id] = {
          file,
          bytes: img.bytes,
          width: img.width,
          height: img.height,
          format: img.format,
          source: '豆瓣读书',
          sourceUrl: `https://book.douban.com/subject/${db.sid}/`,
          subjectId: db.sid,
          matched: 'shlib-isbn',
          isbn,
          query: `上图 OPAC 书号 ${isbn}`,
          edition: { title: db.info.title || title, author: t.book.author, year: db.info.year || '' },
          bookYear: t.book.editionYear || '',
          yearMatch: entryYear && bookYear ? entryYear === bookYear : null,
          fetchedAt: new Date().toISOString(),
        };
        delete index.misses[t.id];
      }
      done = true;
      break;
    }
    if (!done) {
      noCover += 1;
      if (targets.length <= 40) console.log(color(`  · 《${title}》：上图给了书号（${sh.isbns[0]}），但豆瓣没有可用封面`, C.dim));
    }
  } catch (e) {
    if (targets.length <= 40) console.log(color(`  · 《${title}》✗ ${e.message}`, C.dim));
  }
}

console.log('');
console.log(color(`  ✓ 救回 ${saved} 部 ／ 上图没书号 ${noIsbn} 部 ／ 有书号但豆瓣无图 ${noCover} 部`, C.green));
for (const s of savedIds.slice(0, 12)) console.log(color(`    · ${s}`, C.dim));
if (savedIds.length > 12) console.log(color(`    … 其余 ${savedIds.length - 12} 部省略`, C.dim));

if (!APPLY) {
  console.log('');
  console.log('  这是干跑。确认后加 --apply 写回。');
  process.exit(0);
}
index.generatedAt = new Date().toISOString();
fs.writeFileSync(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
console.log('  ✓ 已写回 data/covers.json');
console.log('  接着跑：node scripts/fetch-covers.mjs --seed-editions && node scripts/gen-cover-manifest.mjs && node scripts/check-covers.mjs');
