#!/usr/bin/env node
/**
 * 数据质量审计
 * ============
 * 与 check-data.mjs 的分工：
 *   check-data.mjs —— 合规性（结构、字数、反剧透），失败会让 CI 挂掉
 *   本脚本        —— 质量性（标签是否单薄、字段是否有缺失），只做提示
 *
 * 输出四类清单：
 *   1. 诡计标签单薄的条目（< 2 个）—— 推荐质量会明显下降
 *   2. 缺少关键字段的条目（原作名、系列、主角、国别等）
 *   3. 同一作者收录过多（推荐算法限制同作者最多 2 本）
 *   4. 近期新增批次里仍需补评分的条目
 *
 * 运行：node scripts/audit-quality.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeSeedBook } from '../web/js/core/seed.js';
import { tagCategory, tagLabel } from '../web/js/core/tags.js';
import { bookTagIds } from '../web/js/core/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');

const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m', cyan: '\u001b[36m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

/**
 * 「同一作者收录较多」的提示阈值。
 *
 * ⚠️ 这不是「超标」，也不代表该少收。本项目的目标就是**尽量收全推理小说**，
 * 收录量本身从来不是缺陷。这里只用于提示一个**显示层**的副作用：
 * 推荐算法对同一作者最多推荐 2 本，所以同一作者的书不会在一次推荐里大量并列。
 * 也就是说，这个数字大只影响"它们如何出现在推荐里"，不影响"该不该收"。
 */
const AUTHOR_SOFT_CAP = 6;

function loadBooks() {
  const books = [];
  for (const file of fs.readdirSync(BOOKS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()) {
    let list;
    try {
      list = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, file), 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const book = normalizeSeedBook(item, null, file);
      if (book) books.push(book);
    }
  }
  return books;
}

function main() {
  const books = loadBooks();
  console.log('');
  console.log(color('  数据质量审计', C.bold) + color(`   共 ${books.length} 部`, C.dim));

  /* ---------- 1. 诡计标签单薄 ---------- */
  const thinTrick = books
    .map((b) => ({
      book: b,
      trickCount: bookTagIds(b).filter((id) => tagCategory(id) === 'trick').length,
      total: bookTagIds(b).length,
    }))
    .filter((x) => x.trickCount < 2)
    .sort((a, b) => a.trickCount - b.trickCount);

  console.log('');
  console.log(color(`  [1] 诡计标签少于 2 个（${thinTrick.length} 部）`, C.bold));
  if (!thinTrick.length) {
    console.log(color('    无', C.green));
  } else {
    console.log(color('    这些书的推荐主要靠叙事/场景/题材标签支撑，标注上属于"证据不足"而非遗漏', C.dim));
    for (const item of thinTrick) {
      const tricks = bookTagIds(item.book)
        .filter((id) => tagCategory(id) === 'trick')
        .map(tagLabel)
        .join('、');
      console.log(
        `    ${String(item.trickCount)} 个  《${item.book.title}》(${item.book.author})` +
          color(`  [${item.book.genre}]`, C.dim) +
          (tricks ? color(`  ${tricks}`, C.cyan) : color('  无', C.yellow)),
      );
    }
  }

  /* ---------- 2. 关键字段缺失 ---------- */
  const fields = [
    ['originalTitle', '原作名'],
    ['country', '国别'],
    ['firstPublished', '首次出版'],
  ];
  console.log('');
  console.log(color('  [2] 关键字段缺失', C.bold));
  for (const [key, label] of fields) {
    const missing = books.filter((b) => !b[key]);
    const pct = Math.round((missing.length / books.length) * 100);
    const line = `    ${label.padEnd(6)} 缺失 ${String(missing.length).padStart(3)} / ${books.length}（${pct}%）`;
    console.log(missing.length === 0 ? color(line, C.green) : line);
    if (missing.length && missing.length <= 8) {
      console.log(color(`      ${missing.map((b) => b.title).join('、')}`, C.dim));
    }
  }

  /* ---------- 3. 同一作者收录分布（了解用，不是缺陷） ---------- */
  const byAuthor = new Map();
  for (const b of books) byAuthor.set(b.author, (byAuthor.get(b.author) ?? 0) + 1);
  const crowded = [...byAuthor.entries()].filter(([, n]) => n > AUTHOR_SOFT_CAP).sort((a, b) => b[1] - a[1]);

  console.log('');
  console.log(color(`  [3] 同一作者收录超过 ${AUTHOR_SOFT_CAP} 本（${crowded.length} 位）`, C.bold));
  if (!crowded.length) {
    console.log(color('    无', C.green));
  } else {
    console.log(
      color('    仅供了解收录分布，不是问题——本项目以「尽量收全」为目标，收录越多越好。', C.dim),
    );
    console.log(
      color('    唯一影响：推荐结果里同一作者最多 2 本，故同作者的书不会在一次推荐中大量并列。', C.dim),
    );
    for (const [author, n] of crowded) console.log(`    ${String(n).padStart(3)} 本  ${author}`);
  }

  /* ---------- 4. 待补评分 ---------- */
  const pending = books.filter((b) => !b.ratings?.douban?.sourceUrl);
  console.log('');
  console.log(color('  [4] 豆瓣评分尚未实时抓取（' + pending.length + ' 部）', C.bold));
  if (!pending.length) {
    console.log(color('    无，全部条目均带来源链接', C.green));
  } else {
    const byFile = new Map();
    for (const b of pending) byFile.set(b.seedFile, (byFile.get(b.seedFile) ?? 0) + 1);
    for (const [file, n] of [...byFile.entries()].sort()) {
      console.log(`    ${String(n).padStart(3)} 部  ${file}`);
    }
    console.log(color('    运行 npm run ratings:update 可补齐', C.dim));
  }

  console.log('');
  const totalIssues = thinTrick.length + crowded.length;
  console.log(
    totalIssues === 0
      ? color('  ✓ 未发现质量问题', C.green + C.bold)
      : color(`  i 共 ${totalIssues} 处可改进项（均为提示级，不影响系统运行）`, C.yellow),
  );
  console.log('');
}

main();
