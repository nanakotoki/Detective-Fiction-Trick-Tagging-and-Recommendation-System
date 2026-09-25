#!/usr/bin/env node
/**
 * 体裁归一（维护工具）
 * ==================
 * 知识库是分批写的，`genre` 字段里混进了不少自由写法：
 * 「社会派推理」「心理犯罪」「本格推理（不可能犯罪）」「法庭派」……
 *
 * 这些值在 `normalizeSeedBook` 里会被 `canonicalGenre` 映射到规范体裁，
 * 原措辞会保留在 `genreDetail` 里，所以**归一不会丢信息**。但有两种情况必须处理：
 *   · 映射结果是「其他」——这本书在体裁筛选里就彻底找不到了
 *     （「法庭派」曾是这样，4 部书受影响）
 *   · 文件里写一个值、页面显示另一个值——人工核对数据时会对不上
 *
 * 归一后 `check-data.mjs` 的体裁白名单校验才会真正起作用：
 * 它报出的每一条都是新写坏的值，而不是历史遗留的噪音。
 *
 * 用法：
 *   node scripts/fix-genres.mjs            预演
 *   node scripts/fix-genres.mjs --apply    写入
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENRE_OPTIONS, canonicalGenre } from '../web/js/core/seed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');
const APPLY = process.argv.includes('--apply');

/** 规范体裁里没有对应项时的兜底（人工决定，不交给自动映射） */
const FALLBACK = {
  法庭派: '犯罪悬疑', // 法庭派在规范列表里没有对应项，归到犯罪悬疑最贴近
};

const changes = new Map(); // 原始值 → 目标值
const perBook = [];

for (const file of fs.readdirSync(BOOKS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()) {
  const abs = path.join(BOOKS_DIR, file);
  const list = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!Array.isArray(list)) continue;
  let dirty = false;

  for (const book of list) {
    const raw = String(book.genre ?? '').trim();
    if (!raw || GENRE_OPTIONS.includes(raw)) continue;
    const target = FALLBACK[raw] ?? canonicalGenre(raw);
    if (target === raw || !GENRE_OPTIONS.includes(target)) continue;
    book.genre = target;
    dirty = true;
    changes.set(raw, target);
    perBook.push({ file, id: book.id, title: book.title, from: raw, to: target });
  }

  if (dirty && APPLY) fs.writeFileSync(abs, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
}

console.log('');
console.log('  体裁归一');
console.log('  ────────────────────────────────────────────');
if (!perBook.length) {
  console.log('  ✓ 全部体裁均已是规范值');
} else {
  console.log('  映射关系：');
  for (const [from, to] of changes) console.log(`      ${from} → ${to}`);
  console.log('');
  console.log(`  涉及 ${perBook.length} 部作品：`);
  for (const p of perBook) console.log(`      ${p.file}#${p.id}  《${p.title}》  ${p.from} → ${p.to}`);
}
console.log('');
console.log(
  APPLY
    ? `  ✓ 已写入（原措辞保留在各条的 genreDetail 中，展示时仍可见）`
    : '  预演模式（未写入）。加 --apply 执行。'
);
console.log('');
