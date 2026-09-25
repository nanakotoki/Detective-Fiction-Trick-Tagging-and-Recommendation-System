#!/usr/bin/env node
/**
 * 原作名共用体检（维护工具）
 * ========================
 * `originalTitle` 应当是**这一部作品**的原名。但分批写库时容易把
 * 「选集名 / 系列名」当成原作名填进去，例如《思考机器探案集》系列四卷
 * 都被填成 `The Thinking Machine`——那是整套选集的名字，不是各卷的名字。
 *
 * 危害：按原作名判重会把同一系列的相邻各卷当成重复条目合并掉。
 *
 * 本脚本找出「同一个原作名被多条记录共用、且各条中文书名互不相同」的情况，
 * 列出供人工判断：是真的异名同书，还是原作名填错了。
 *
 * 用法：node scripts/origtitle-scan.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_DIR = path.resolve(__dirname, '..', 'data', 'books');

const NOISE = /[\s\u3000《》〈〉·・:：,，.。、\-—－_/\\|()（）[\]【】「」『』!！?？"'“”‘’]/g;
const norm = (s) => String(s ?? '').replace(NOISE, '').toLowerCase();

const groups = new Map();
for (const f of fs.readdirSync(BOOKS_DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_')).sort()) {
  const list = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, f), 'utf8'));
  if (!Array.isArray(list)) continue;
  for (const b of list) {
    const o = norm(b.originalTitle);
    if (!o) continue;
    if (!groups.has(o)) groups.set(o, []);
    groups.get(o).push({ ...b, __file: f });
  }
}

let flagged = 0;
const clean = [];
for (const [, v] of groups) {
  if (v.length < 2) continue;
  const titles = [...new Set(v.map((b) => b.title))];
  const years = [...new Set(v.map((b) => String(b.firstPublished || '').trim()).filter(Boolean))];
  if (titles.length === 1) continue; // 同名，属正常重复，交由 merge-dups 处理
  flagged++;
  console.log('');
  console.log(`  ! 原作名共用：${v[0].originalTitle}`);
  console.log(`      中文书名 ${titles.length} 种，首版年 ${years.length ? years.join(' / ') : '（均未填）'}`);
  for (const b of v) {
    const d = (b.ratings || {}).douban || {};
    console.log(
      `      · 《${b.title}》 ${b.author} | 首版 ${JSON.stringify(b.firstPublished || '')} | 豆瓣 ${d.score ?? '—'}${d.count ? `(${d.count}人)` : ''} | ${b.__file}#${b.id}`
    );
  }
  console.log(
    years.length > 1
      ? '      → 首版年不一致，多半是**不同的书**，原作名需要拆开填写。'
      : '      → 首版年一致，可能是异名同书；也可能原作名填成了选集名/系列名。'
  );
  clean.push({ orig: v[0].originalTitle, ids: v.map((b) => b.id) });
}

console.log('');
console.log('  ────────────────────────────────────────────');
console.log(`  ${flagged} 组原作名被多条记录共用且中文书名不同`);
console.log('');
