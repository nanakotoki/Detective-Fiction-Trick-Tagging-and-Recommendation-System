#!/usr/bin/env node
/**
 * 「两部不同的书指向同一条豆瓣条目」体检（第 181 轮·D 线）
 * ==================================================
 * 第 181 轮收尾时顺手问了一句：那 27 组「两边都是主图、图又完全相同」里，
 * 是**出版社同一套设计**，还是**我们配错了条目**？
 *
 * 判据很硬：**一条豆瓣条目只可能是一部作品**——若两部不同的书都指向同一条条目，
 * 至少有一边是错的。全库查出 16 组属于这一类（另有 4 组指向不同条目、图却相同，
 * 那是出版社真的用了同一张设计，是事实）。
 *
 * 这 16 组再按**题名**分两类：
 *   · 条目题名与组里每本书都对得上 → **合集／套装／上下卷**，一条条目确实覆盖多部作品
 *     （《扭曲的人性/赌命复仇》就是一本里装了两部），两边共用同一张封面是**对的**；
 *   · 只有一部分对得上 → 另一边的封面是**别人那一卷的图**（《犯罪心理师Ⅱ》挂着第一部的封面），
 *     属配错，要等豆瓣通了按题名重查（HTML 页仍限流，§179.4）。
 *
 * ⚠️ 题名判据是「互为包含即算同一题名」，所以**卷次标记要单独看**：
 * 《乱步侦探作品集.1》会被判成与《乱步侦探作品集.10》「吻合」（前者是后者的前缀）——
 * 这一版把「一边多出卷次标记（Ⅰ/Ⅱ、.1、上/下、第N卷）」的情形单独标出来，不混进「套装」。
 *
 * 用法：`node scripts/audit-shared-entries.mjs`（只读，不改数据；供接新来源后复跑）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { sameTitleEdition } from './lib/covers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'covers.json'), 'utf8'));
const books = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'data', 'books'))) {
  if (!f.endsWith('.json') || f.startsWith('_')) continue;
  for (const b of JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'books', f), 'utf8'))) books.set(b.id, b);
}

/** 卷次标记：Ⅰ/Ⅱ、.1、上/下/中、第N卷册部辑 —— 有与没有，是两卷不同的书 */
const volumeMarker = (title) => {
  const t = String(title || '');
  const m =
    t.match(/[.·・\s]*(?:[ⅠⅡⅢⅣⅤ]|[0-9]+)\s*$/) ||
    t.match(/[（(]?[上中下][册卷]?[)）]?\s*$/) ||
    t.match(/第[一二三四五六七八九十0-9]+[卷册部辑]/);
  return m ? m[0].replace(/[.·・\s（）()]/g, '') : '';
};

const owners = new Map();
for (const [id, rec] of Object.entries(index.records)) {
  if (rec.file) owners.set(rec.file, { book: id, kind: 'primary' });
  for (const e of rec.editions || []) if (e.file && !owners.has(e.file)) owners.set(e.file, { book: id, kind: 'edition' });
}
const byHash = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'web', 'covers'))) {
  if (f === '_placeholder.svg') continue;
  const p = path.join(ROOT, 'web', 'covers', f);
  if (!fs.statSync(p).isFile()) continue;
  const h = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
  if (!byHash.has(h)) byHash.set(h, []);
  byHash.get(h).push({ file: f, ...(owners.get(f) || { book: '(未登记)', kind: '?' }) });
}

const omnibus = [];
const volumeMismatch = [];
const unclear = [];
let differentEntry = 0;
for (const [, group] of byHash) {
  if (group.length < 2) continue;
  const ids = [...new Set(group.map((g) => g.book))];
  if (ids.length < 2) continue;
  if (group.some((g) => g.kind === 'edition')) continue; // 「其他版本」共图由 dedupe-cross-book 管
  const subjectIds = new Set(ids.map((id) => String(index.records[id]?.subjectId || '')));
  if (subjectIds.size !== 1) {
    differentEntry += 1;
    continue;
  }
  const entryTitle = index.records[ids[0]]?.edition?.title || '';
  const label = `${ids.map((id) => `${id}《${books.get(id)?.title || '?'}》`).join(' ↔ ')}｜条目 ${[...subjectIds][0]}《${entryTitle}》`;
  const matches = ids.filter((id) => sameTitleEdition(books.get(id)?.title || '', entryTitle));
  const entryMarker = volumeMarker(entryTitle);
  const markerMismatch = ids.some((id) => volumeMarker(books.get(id)?.title || '') !== entryMarker);
  if (!matches.length) unclear.push(label);
  else if (markerMismatch) volumeMismatch.push(`${label}（卷次标记不一致：条目「${entryMarker || '无'}」）`);
  else omnibus.push(label);
}

console.log('');
console.log(`  「两部不同的书指向同一条豆瓣条目」体检：`);
console.log(`    指向不同条目、图却相同（出版社同一套设计，是事实）：${differentEntry} 组`);
console.log(`    ○ 合集／套装／上下卷，共用一条条目是对的：${omnibus.length} 组`);
for (const s of omnibus) console.log(`      · ${s}`);
console.log(`    ✗ 卷次标记不一致（另一边的封面是别人那一卷的图，待豆瓣按题名重查）：${volumeMismatch.length} 组`);
for (const s of volumeMismatch) console.log(`      · ${s}`);
console.log(`    ？ 判不了（要人工看）：${unclear.length} 组`);
for (const s of unclear) console.log(`      · ${s}`);
console.log('');
