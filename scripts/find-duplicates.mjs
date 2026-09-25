#!/usr/bin/env node
/**
 * 重名 / 重复条目闸门
 * ==================
 * 同一部作品可能以两个不同的中文译名各收一条（大陆版 / 台版 / 旧译），
 * 这是最危险的一类数据问题：书名确实不同，不会被「书名重复」检查发现，
 * 但会在推荐里让同一本书自己推荐自己，并且污染相似度统计与「按作者收全」的进度。
 *
 * 判定规则见 `scripts/lib/dup-rules.mjs`——与修复工具 `merge-dups.mjs`
 * **共用同一套规则**，所以本脚本报出的每一组，`npm run fix:dups -- --apply`
 * 都能修掉。两者若不一致，闸门会长期报出修不了的误报，最终被整体忽略。
 *
 * 用法：
 *   node scripts/find-duplicates.mjs            只看重复
 *   node scripts/find-duplicates.mjs --json     机器可读
 *   node scripts/find-duplicates.mjs --strict   发现重复即退出码 1（供 CI 用）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { duplicateReason, looksLikeCollectionName } from './lib/dup-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');

const AS_JSON = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict');
const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

/* ---------------- 读取全库 ---------------- */
const books = [];
for (const f of fs.readdirSync(BOOKS_DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_')).sort()) {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, f), 'utf8'));
  } catch (e) {
    console.error(`  ✗ ${f} 解析失败：${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(list)) continue;
  for (const b of list) books.push({ ...b, _file: f });
}

/* ---------------- 两两比对 ---------------- */
const pairs = [];
for (let i = 0; i < books.length; i += 1) {
  for (let j = i + 1; j < books.length; j += 1) {
    const reason = duplicateReason(books[i], books[j]);
    if (reason) pairs.push({ a: books[i], b: books[j], reason });
  }
}

/* ---------------- 原作名被多条共用（可能是选集名填错） ---------------- */
const byOrig = new Map();
for (const b of books) {
  const key = String(b.originalTitle ?? '').trim();
  if (!key) continue;
  if (!byOrig.has(key)) byOrig.set(key, []);
  byOrig.get(key).push(b);
}
const collectionSuspects = [];
for (const [orig, list] of byOrig) {
  if (list.length < 2) continue;
  if (looksLikeCollectionName(list)) collectionSuspects.push({ orig, list });
}

/* ---------------- 输出 ---------------- */
const ok = pairs.length === 0;

if (AS_JSON) {
  console.log(
    JSON.stringify(
      {
        total: books.length,
        duplicateCount: pairs.length,
        duplicates: pairs.map((p) => ({
          a: { id: p.a.id, title: p.a.title, originalTitle: p.a.originalTitle, file: p.a._file },
          b: { id: p.b.id, title: p.b.title, originalTitle: p.b.originalTitle, file: p.b._file },
          rule: p.reason.rule,
          detail: p.reason.detail,
        })),
        collectionSuspects: collectionSuspects.map((c) => ({
          originalTitle: c.orig,
          books: c.list.map((b) => ({ id: b.id, title: b.title, file: b._file })),
        })),
      },
      null,
      2
    )
  );
} else {
  console.log('');
  console.log(color('  重复条目闸门', C.bold));
  console.log(color('  ────────────────────────────────────────────', C.dim));
  console.log(`  全库 ${books.length} 部（${books.length ? new Set(books.map((b) => b._file)).size : 0} 个数据文件）`);
  console.log('');

  if (ok) {
    console.log(color('  ✓ 未发现重复条目', C.green + C.bold));
  } else {
    console.log(color(`  ✗ 发现 ${pairs.length} 组重复条目`, C.red + C.bold));
    console.log(color('    运行 `node scripts/merge-dups.mjs --apply` 合并（会先预演）', C.dim));
    console.log('');
    for (const p of pairs) {
      console.log(color(`  ✗ 《${p.a.title}》 ↔ 《${p.b.title}》`, C.red));
      console.log(color(`      ${p.a._file} · ${p.a.id}   /   ${p.b._file} · ${p.b.id}`, C.dim));
      console.log(color(`      ${p.reason.detail}`, C.dim));
    }
  }

  if (collectionSuspects.length) {
    console.log('');
    console.log(color(`  ! ${collectionSuspects.length} 组原作名被多条记录共用且书名互不相同`, C.yellow + C.bold));
    console.log(color('    可能把「选集名 / 系列名」当成了原作名，需人工核对 originalTitle', C.dim));
    for (const c of collectionSuspects) {
      console.log(color(`      ${c.orig}`, C.yellow));
      for (const b of c.list) console.log(color(`          《${b.title}》 ${b._file} · ${b.id}`, C.dim));
    }
  }

  console.log('');
}

if (STRICT && !ok) process.exit(1);
