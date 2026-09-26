#!/usr/bin/env node
/**
 * 作者名异写扫描 `audit-author-names`
 * ================================
 * **起因**：第 85 轮把多萝西·塞耶斯的两种写法归一后，`find-duplicates.mjs` **立刻报出一条
 * 此前看不见的重复条目**（《杀人必须宣传》↔《杀人广告》，同一部 *Murder Must Advertise*）——
 * 原因是查重闸门要求**作者与题名同时对得上**，作者名一分裂，重复条目就被屏蔽了。
 *
 * 也就是说：**库内每存在一组作者名异写，就对应一个查重盲区**。
 * 本脚本专门把这些盲区找出来，交人工判断——**只报告，不改数据**。
 *
 * 判据（两类，都只用于「找候选」，不自动合并）：
 *   ① **去掉拉丁字母与标点后同键**：如「多萝西·L·塞耶斯」与「多萝西·塞耶斯」→ `多萝西塞耶斯`；
 *      「P. D. 詹姆斯」与「P.D.詹姆斯」→ `詹姆斯`；
 *   ② **互为前后缀**：如「阿瑟·柯南·道尔」与「柯南·道尔」（这类多为「名 + 姓」与「姓」两种写法）。
 *
 * 用法：
 *   node scripts/audit-author-names.mjs
 *   node scripts/audit-author-names.mjs --min 2   # 只看样本 ≥2 部的组
 */
import { readFileSync, readdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const MIN = Number(argv[argv.indexOf('--min') + 1]) || 1;

/** 归一：只留汉字，去掉拉丁字母、中点、空格、括号内容 */
const key = (s) =>
  String(s || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[^\u4e00-\u9fa5]/g, '');

const files = readdirSync('data/books').filter((x) => x.endsWith('.json') && !x.startsWith('_'));
const count = new Map(); // 作者名 → 部数
for (const f of files) {
  for (const b of JSON.parse(readFileSync(`data/books/${f}`, 'utf8'))) {
    const names = b.authors?.length ? b.authors : [b.author];
    for (const n of names) count.set(n, (count.get(n) || 0) + 1);
  }
}
const names = [...count.keys()];
console.log(`\n  作者名异写扫描`);
console.log('  ────────────────────────────────────────────');
console.log(`  库内署名 ${names.length} 种，合计 ${[...count.values()].reduce((a, b) => a + b, 0)} 条署名\n`);

/** ① 同键异写 */
const byKey = new Map();
for (const n of names) {
  const k = key(n);
  if (k.length < 2) continue; // 纯外文名（如「P. D. James」）不参与
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(n);
}
const groups1 = [...byKey.entries()].filter(([, v]) => v.length > 1);

/** ② 互为前后缀（去标点后比较，避免「柯南·道尔」与「阿瑟·柯南·道尔」漏掉） */
const groups2 = [];
const seen = new Set(groups1.flatMap(([, v]) => v));
for (const a of names) {
  for (const b of names) {
    if (a === b) continue;
    const ka = key(a);
    const kb = key(b);
    if (ka.length < 2 || kb.length < 2) continue;
    if (ka === kb) continue; // 已由 ① 覆盖
    const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
    if (short.length >= 2 && long.includes(short)) {
      const pair = [a, b].sort().join(' ↔ ');
      if (seen.has(pair) || seen.has([b, a].sort().join(' ↔ '))) continue;
      seen.add(pair);
      groups2.push([pair, [a, b]]);
    }
  }
}

const show = (title, rows) => {
  console.log(`  ${title}：${rows.length} 组`);
  for (const [label, list] of rows) {
    const total = list.reduce((s, n) => s + (count.get(n) || 0), 0);
    if (total < MIN) continue;
    console.log(`    ${label}`);
    for (const n of list) console.log(`        ${n}（${count.get(n)} 部）`);
  }
  console.log('');
};

show('① 归一后同键（多为「中间名缩写／中点」之差）', groups1.map(([k, v]) => [`键「${k}」`, v]));
show('② 互为前后缀（多为「名+姓」与「姓」两种写法）', groups2);

console.log('  提示：以上都只是**候选**，需人工确认是否同一人；确认后用');
console.log('        `scripts/register-aliases.mjs` 的 RENAME_AUTHOR 表归一，');
console.log('        并**紧接着跑一遍 `find-duplicates.mjs --strict`**——归一常会钓出被掩盖的重复条目（§85.3）。\n');
