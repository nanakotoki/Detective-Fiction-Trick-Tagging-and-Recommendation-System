#!/usr/bin/env node
/**
 * 候选书目是否已在库中（维护工具）
 * ==============================
 * 往知识库加书之前必须先查一遍：**这本书是不是已经在库里了**。
 *
 * 库里已经出现过 24 组重复条目，全部是「新批次独立检索、没跟既有库比对」造成的。
 * 判定用归一化书名 —— 同一部作品的不同译名之间的重复由
 * `find-duplicates.mjs`（原书名判重）负责，这一步只挡住「同名同书」。
 *
 * 用法：
 *   node scripts/check-new.mjs 半七捕物帐 阿文的魂魄 ...
 *   node scripts/check-new.mjs --file scripts/_cand-xxx.txt
 *   node scripts/check-new.mjs --author 冈本绮堂    顺带列出该作者现有全部条目
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normText } from './lib/dup-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');

const argv = process.argv.slice(2);
const fi = argv.indexOf('--file');
const ai = argv.indexOf('--author');

let titles = argv.filter((a) => !a.startsWith('--'));
if (ai !== -1) titles = titles.filter((t) => t !== argv[ai + 1]);
if (fi !== -1) {
  const file = argv[fi + 1];
  titles = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/* ---------------- 读取全库 ---------------- */
const books = [];
for (const file of fs.readdirSync(BOOKS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()) {
  const list = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, file), 'utf8'));
  if (!Array.isArray(list)) continue;
  for (const b of list) books.push({ ...b, _file: file });
}

const index = new Map();
for (const b of books) {
  const keys = [normText(b.title), ...(b.alternateTitles ?? []).map(normText)].filter(Boolean);
  for (const k of keys) if (!index.has(k)) index.set(k, b);
}

/* ---------------- 作者现有条目 ---------------- */
if (ai !== -1) {
  const author = argv[ai + 1];
  const na = normText(author);
  const owned = books.filter((b) => {
    const nb = normText(b.author);
    return nb === na || nb.includes(na) || na.includes(nb);
  });
  console.log('');
  console.log(`  ${author} 现有 ${String(owned.length)} 部：`);
  for (const b of owned) {
    const d = (b.ratings || {}).douban || {};
    console.log(`      《${b.title}》 ${d.score != null ? `${d.score}(${d.count ?? '?'}人)` : '暂无评分'}  ${b._file}#${b.id}`);
  }
  console.log('');
}

if (!titles.length) {
  if (ai === -1) {
    console.log('\n  用法：node scripts/check-new.mjs <书名...> | --file <清单> | --author <作者>\n');
    process.exit(1);
  }
  process.exit(0);
}

/* ---------------- 逐个查重 ---------------- */
const fresh = [];
const dup = [];
const suspect = [];
for (const t of titles) {
  const key = normText(t);
  const hit = index.get(key);
  if (hit) {
    dup.push({ title: t, book: hit });
    continue;
  }
  /**
   * 包含关系检查。
   *
   * 只做精确书名匹配会漏掉这样一类重复：库里已有的书名是《COSMIC 世纪末侦探神话》，
   * 而候选写的是《世纪末侦探神话》——归一化后一个是「cosmic世纪末侦探神话」、
   * 一个是「世纪末侦探神话」，精确匹配失败，于是放行入库，最后靠判重闸门才发现。
   * （这不是假设，是真实发生过的：本轮就因此多收了一条，靠 merge-dups 合并回去。）
   *
   * 包含关系不能直接判为重复（《巷说百物语》与《后巷说百物语》是两部书），
   * 所以只作提示，交人工判断。
   */
  if (key.length >= 4) {
    const near = books.filter((b) => {
      const names = [b.title, ...(b.alternateTitles ?? [])].map(normText).filter(Boolean);
      return names.some((n) => n !== key && (n.includes(key) || key.includes(n)));
    });
    if (near.length) suspect.push({ title: t, near });
  }
  fresh.push(t);
}

console.log('');
console.log('  候选书目查重');
console.log('  ────────────────────────────────────────────');
console.log(`  候选 ${String(titles.length)} 个 / 已在库 ${String(dup.length)} 个 / 可新增 ${String(fresh.length)} 个`);
console.log('');

if (dup.length) {
  console.log('  ✗ 已在库中（不要重复添加）：');
  for (const d of dup) {
    const dou = (d.book.ratings || {}).douban || {};
    console.log(
      `      《${d.title}》 → 已有《${d.book.title}》 ${d.book.author} | ${d.book._file}#${d.book.id} | 豆瓣 ${dou.score ?? '—'}`
    );
  }
  console.log('');
}

if (fresh.length) {
  console.log('  ✓ 库中没有同名条目：');
  for (const t of fresh) console.log(`      ${t}`);
  console.log('');
}

if (suspect.length) {
  console.log('  ! 书名与现有条目有包含关系，**入库前请人工确认不是同一部作品**：');
  for (const s of suspect) {
    console.log(`      候选《${s.title}》`);
    for (const b of s.near) {
      console.log(`          ↔ 现有《${b.title}》 ${b.author} | ${b._file}#${b.id}`);
    }
  }
  console.log('');
  console.log('      同一系列的各卷也可能互相包含（《巷说百物语》/《后巷说百物语》是两部书），');
  console.log('      所以这里只提示、不拦；但如果是同一部作品，请把候选名写进那条的 alternateTitles。');
  console.log('');
}
