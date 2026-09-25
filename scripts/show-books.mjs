#!/usr/bin/env node
/** 指定 id 的条目字段对照（维护工具）
 *  用法：node scripts/show-books.mjs honkaku-013 mid-017 ...
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_DIR = path.resolve(__dirname, '..', 'data', 'books');
const ids = process.argv.slice(2);
if (!ids.length) {
  console.log('用法：node scripts/show-books.mjs <id> [id...]');
  process.exit(1);
}
const want = new Set(ids);
for (const f of fs.readdirSync(BOOKS_DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_')).sort()) {
  const list = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, f), 'utf8'));
  if (!Array.isArray(list)) continue;
  for (const b of list) {
    if (!want.has(b.id)) continue;
    const d = (b.ratings || {}).douban || {};
    console.log(`\n  ${b.id}   (${f})`);
    console.log(`    中文名 ${b.title}`);
    console.log(`    原作名 ${JSON.stringify(b.originalTitle || '')}`);
    console.log(`    作者   ${b.author} | 首版 ${JSON.stringify(b.firstPublished || '')} | 体裁 ${b.genre}`);
    console.log(`    系列   ${JSON.stringify(b.series || '')} | 侦探 ${JSON.stringify(b.detective || '')}`);
    console.log(`    豆瓣   ${d.score ?? '—'}${d.count ? `(${d.count}人)` : ''}  ${d.editionTitle ? `版本名《${d.editionTitle}》` : ''} ${d.editionYear || ''}`);
    console.log(`    标签   ${(b.tags || []).join(', ')}`);
    console.log(`    梗概   ${String(b.safeSummary || '').slice(0, 100)}`);
  }
}
console.log('');
