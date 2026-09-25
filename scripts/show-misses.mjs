#!/usr/bin/env node
/**
 * 未命中评分清单
 * ==============
 * 把 `data/ratings-atlas.json` 里的未命中项按原因分组列出，用于人工复核。
 *
 * 为什么要单独一个命令：三种未命中的**含义完全不同**，处理方式也不同。
 *   · 豆瓣只索引到外文原版 —— 豆瓣没有中文版条目，评分抓不到是因为索引缺失，
 *     不是这本书没人读。这类要人工判断中文版是否真的出版过。
 *   · 条目存在但尚无评分 —— 数据已经到位，只是平台还没有评分。
 *   · 检索无结果 —— 换遍关键词也没找到可匹配条目，可能要补别名表。
 *
 * 用法：
 *   node scripts/show-misses.mjs                全部分组列出
 *   node scripts/show-misses.mjs --group foreign  只看「只索引到外文原版」
 *   node scripts/show-misses.mjs --group none      只看「条目存在但尚无评分」
 *   node scripts/show-misses.mjs --group nomatch   只看「检索无结果」
 *   node scripts/show-misses.mjs --json            机器可读
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ATLAS = path.join(ROOT, 'data', 'ratings-atlas.json');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');

const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const gi = argv.indexOf('--group');
const only = gi === -1 ? null : argv[gi + 1];

const atlas = JSON.parse(fs.readFileSync(ATLAS, 'utf8'));

/** id → 书（补上作者与原书名，便于人工判断） */
const byId = new Map();
for (const file of fs.readdirSync(BOOKS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()) {
  const list = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, file), 'utf8'));
  if (!Array.isArray(list)) continue;
  for (const b of list) byId.set(b.id, b);
}

const GROUPS = {
  foreign: { label: '豆瓣只索引到外文原版（中文版未进检索索引）', test: (r) => /只索引到外文原版/.test(r) },
  none: { label: '条目存在但尚无评分', test: (r) => /尚无评分/.test(r) },
  nomatch: { label: '检索无结果', test: (r) => /检索无结果/.test(r) },
};

const misses = Array.isArray(atlas.misses) ? atlas.misses : [];
const rows = misses.map((m) => {
  const b = byId.get(m.id) ?? {};
  const reason = String(m.reason ?? '');
  const key = Object.keys(GROUPS).find((k) => GROUPS[k].test(reason)) ?? 'other';
  return {
    id: m.id,
    title: m.title,
    author: b.author ?? '',
    originalTitle: b.originalTitle ?? '',
    country: b.country ?? '',
    group: key,
    reason,
  };
});

if (AS_JSON) {
  console.log(JSON.stringify({ total: rows.length, rows }, null, 2));
  process.exit(0);
}

console.log('');
console.log('  未命中评分清单');
console.log('  ────────────────────────────────────────────');
console.log(`  图谱已覆盖 ${String(atlas.records?.length ?? 0)} 部，未命中 ${String(rows.length)} 部`);
console.log('');

for (const [key, def] of Object.entries(GROUPS)) {
  if (only && only !== key) continue;
  const hit = rows.filter((r) => r.group === key);
  console.log(`  【${def.label}】${String(hit.length)} 部`);
  if (!hit.length) console.log('      （无）');
  for (const r of hit) {
    console.log(`      《${r.title}》 ${r.author}${r.country ? `（${r.country}）` : ''}`);
    if (r.originalTitle) console.log(`          原名：${r.originalTitle}`);
    console.log(`          原因：${r.reason}`);
  }
  console.log('');
}

const others = rows.filter((r) => r.group === 'other');
if (others.length && !only) {
  console.log(`  【其他原因】${String(others.length)} 部`);
  for (const r of others) console.log(`      《${r.title}》—— ${r.reason}`);
  console.log('');
}

console.log('  说明：这些作品**仍然在知识库里**，只是评分一栏如实标注「暂无数据」。');
console.log('        「只索引到外文原版」这一类，豆瓣上确实有这本书，但只有日文/英文');
console.log('        原版条目；中文版是否出版过，需要人工核对，本系统不代为断言。');
console.log('');
