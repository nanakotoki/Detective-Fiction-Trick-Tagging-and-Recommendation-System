#!/usr/bin/env node
/**
 * 作者总名单覆盖率审计
 * ======================
 * `data/authors-master.json` 是**收录基准**：用户给定的 130 位作者名单。
 * 这个工具回答一个问题：这份名单上还有谁没收、谁的部数明显偏少。
 *
 * 用法：
 *   node scripts/master-audit.mjs                全部区域
 *   node scripts/master-audit.mjs 中国            只看某个区域
 *   node scripts/master-audit.mjs --missing       只列出库里还没有的作者
 *   node scripts/master-audit.mjs --thin 3        只列出在库不足 3 部的作者
 *
 * 判定说明：
 *   · 作者名做**别名归一**（如名单里的「木木高太郎」在库里写作「木木高太郎」、
 *     「孙沁文（鸡丁）」在库里是「孙沁文」），否则会把已收录的误判成没收
 *   · 「在库 0 部」= 名单上有、知识库里一位作品都没有，是最该补的
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');
const MASTER = path.join(ROOT, 'data', 'authors-master.json');

/**
 * 名单名 -> 库内名 的别名映射。
 * 名单是人工整理的，写法与数据文件里未必一致；不归一就会误报「未收录」。
 */
const ALIASES = {
  '孙沁文（鸡丁）': '孙沁文',
  法医秦明: '秦明',
  // 名单写「杰弗里」，豆瓣与数据文件里是「杰夫里」
  杰弗里·迪弗: '杰夫里·迪弗',
};

/**
 * 作者名归一：去掉国别前缀、中点、空格。
 *
 * 不做这一步会误报：库里写的是「G·K·切斯特顿」「S·S·范·达因」，
 * 名单里是「G.K.切斯特顿」「S.S.范·达因」——只差中点与小数点，
 * 但按字面比较就会被算成"未收录"，进而重复收录同一位作者。
 */
const normalizeAuthor = (name) =>
  String(name ?? '')
    .replace(/^\[[^\]]*\]\s*/, '')
    .replace(/[·・.\s\u3000]/g, '')
    .trim();

const argv = process.argv.slice(2);
const onlyMissing = argv.includes('--missing');
const thinIndex = argv.indexOf('--thin');
const thin = thinIndex === -1 ? 0 : Number(argv[thinIndex + 1]) || 0;
const regionFilter = argv.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) ?? null;

const master = JSON.parse(fs.readFileSync(MASTER, 'utf8'));

const books = [];
for (const file of fs.readdirSync(BOOKS_DIR).filter((f) => f.endsWith('.json'))) {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, file), 'utf8'));
  } catch {
    continue;
  }
  if (Array.isArray(list)) books.push(...list);
}

/** 归一后的作者名 -> 作品数 */
const byAuthor = new Map();
for (const b of books) {
  const a = normalizeAuthor(b.author);
  if (!a) continue;
  byAuthor.set(a, (byAuthor.get(a) ?? 0) + 1);
}

const lookup = (name) => byAuthor.get(normalizeAuthor(ALIASES[name] ?? name)) ?? 0;

let totalAuthors = 0;
let coveredAuthors = 0;
let totalBooks = 0;
const zero = [];

for (const group of master.regions) {
  if (regionFilter && group.region !== regionFilter) continue;

  const rows = group.authors.map((name) => ({ name, count: lookup(name) }));
  rows.sort((a, b) => a.count - b.count || a.name.localeCompare(b.name, 'zh'));

  const shown = onlyMissing
    ? rows.filter((r) => r.count === 0)
    : thin
      ? rows.filter((r) => r.count < thin)
      : rows;

  console.log('');
  console.log(`  【${group.region}】名单 ${group.authors.length} 位，其中在库 ${rows.filter((r) => r.count > 0).length} 位`);

  if (!shown.length) {
    console.log('    （无符合条件者）');
  } else {
    // 按行铺开，每行 4 个，便于一眼扫完
    const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
    for (let i = 0; i < shown.length; i += 4) {
      const line = shown
        .slice(i, i + 4)
        .map((r) => `${pad(r.name, 18)} ${String(r.count).padStart(2)} 部`)
        .join('   ');
      console.log(`    ${line}`);
    }
  }

  totalAuthors += rows.length;
  coveredAuthors += rows.filter((r) => r.count > 0).length;
  totalBooks += rows.reduce((s, r) => s + r.count, 0);
  for (const r of rows) if (r.count === 0) zero.push(`${group.region}/${r.name}`);
}

console.log('');
console.log('  ────────────────────────────────────────────');
console.log(`  名单作者 ${totalAuthors} 位，已收录 ${coveredAuthors} 位（${Math.round((coveredAuthors / totalAuthors) * 100)}%）`);
console.log(`  名下作品合计 ${totalBooks} 部 / 全库 ${books.length} 部`);
if (zero.length) {
  console.log('');
  console.log(`  ! 尚未收录的 ${zero.length} 位：`);
  for (let i = 0; i < zero.length; i += 4) console.log(`    ${zero.slice(i, i + 4).join('   ')}`);
}
console.log('');
