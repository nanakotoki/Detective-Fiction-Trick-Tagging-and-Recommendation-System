#!/usr/bin/env node
/**
 * 选出「还没按作者枚举过」的薄作者（第 8 轮扫描用）
 * ==============================================
 * 用户口径是「尽量每个作者弄全」。前 7 轮已经把 ≥3 部的作者扫完了，
 * 剩下 ~300 位「库里只有 1~2 部」的作者从没枚举过。
 *
 * 这个工具只做一件事：把「库里 1~2 部」且「没有出现在 author-scan*.tsv 的 __DONE__ 行里」
 * 的作者列出来，按已有部数升序、作者名排序，写成候选名单文件。
 *
 * 用法：node scripts/_nextscan8.mjs [--min 1] [--max 2] [--out _dd/next8.txt] [--limit 40]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOKS = path.join(ROOT, 'data', 'books');
const DD = path.join(ROOT, '_dd');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const min = Number(arg('--min', '1'));
const max = Number(arg('--max', '2'));
const out = arg('--out', '_dd/next8.txt');
const limit = Number(arg('--limit', '0'));

// 1) 库里已有作品
const books = [];
for (const f of fs.readdirSync(BOOKS).filter((f) => f.endsWith('.json'))) {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(path.join(BOOKS, f), 'utf8'));
  } catch {
    continue;
  }
  if (Array.isArray(list)) books.push(...list);
}

const count = new Map();
for (const b of books) {
  const names = Array.isArray(b.authors) && b.authors.length ? b.authors : [b.author];
  for (const n of names) {
    const k = String(n || '').trim();
    if (!k) continue;
    count.set(k, (count.get(k) || 0) + 1);
  }
}

// 2) 已经枚举过的作者
const scanned = new Set();
for (const f of fs.readdirSync(DD).filter((f) => /^author-scan\d*\.tsv$/.test(f))) {
  for (const line of fs.readFileSync(path.join(DD, f), 'utf8').split(/\r?\n/)) {
    const c = line.split('\t');
    if (c[1] === '__DONE__') scanned.add(c[0]);
  }
}

const pending = [...count.entries()]
  .filter(([n, c]) => c >= min && c <= max && !scanned.has(n))
  .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0], 'zh'));

console.log(`库里作品总数 ${books.length} 部，作者 ${count.size} 位`);
console.log(`已枚举过 ${scanned.size} 位；待枚举（${min}~${max} 部）${pending.length} 位`);

const picked = limit > 0 ? pending.slice(0, limit) : pending;
fs.writeFileSync(path.join(ROOT, out), picked.map(([n]) => n).join('\n') + '\n', 'utf8');
console.log(`写入 ${out}：${picked.length} 位`);
console.log('');
for (const [n, c] of picked.slice(0, 60)) console.log(`  ${String(c)} 部  ${n}`);
if (picked.length > 60) console.log(`  … 其余 ${picked.length - 60} 位见文件`);
