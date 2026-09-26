#!/usr/bin/env node
/**
 * `firstPublished` 回填（按 §103 收严后的规则）
 * ============================================
 * 背景：库内 204 条「中文原创、`firstPublished` 空、版本年已知」的条目里，
 * **不能**按「中文原创就回填」——那多的「那多手记」系列首版在 2004–2008 年，
 * 而《亡者永生》这一册的版本年是 2018（重印）。把重印年当首版年填进去，
 * 是**闸门查不出来**的那类错。
 *
 * 因此本脚本只认一种情形：**证据串里明确写出「本版即首版／首次出版／初版」**。
 * 只有这种条目才用版本年回填 `firstPublished`，并在证据里留下回填记录。
 *
 * 用法：
 *   node scripts/backfill-first-published.mjs            # 干跑，只打印将改动什么
 *   node scripts/backfill-first-published.mjs --apply    # 写入
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
/** 「本版即首版」的明确表述——**只有这些**才算数，「中文原创」不算 */
const FIRST_EDITION = /(本版即首版|首次出版|初版|首版即本版)/;
const files = readdirSync('data/books').filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const dirty = new Map();
let n = 0;

for (const f of files) {
  const arr = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  let touched = false;
  for (const b of arr) {
    if (b.country !== '中国' || b.firstPublished || !b.editionYear) continue;
    const src = String(b.verification?.source || '');
    if (!FIRST_EDITION.test(src)) continue;
    console.log(`✓ 《${b.title}》 ${b.author} → firstPublished = ${b.editionYear}（证据写明首版）`);
    b.firstPublished = String(b.editionYear);
    b.verification.source += ` **首版年回填（第 104 轮）**：证据串写明本版即首版，故把版本年 ${b.editionYear} 记入 \`firstPublished\`（按 §103 的规则：**只有写明首版的才回填**，仅写「中文原创」的一律留空）。`;
    touched = true;
    n += 1;
  }
  if (touched) dirty.set(f, arr);
}

console.log(`\n命中 ${n} 条${APPLY ? '' : '（干跑，未落盘）'}`);
if (APPLY) {
  for (const [f, arr] of dirty) writeFileSync(`data/books/${f}`, JSON.stringify(arr, null, 2) + '\n', 'utf8');
  console.log(`已写入 ${dirty.size} 个文件`);
}
