#!/usr/bin/env node
/**
 * 系列名／主角名异写扫描 `audit-series-names`
 * =========================================
 * **起因**：第 86 轮做出作者名异写扫描后，台账里记了一句待办——
 * 「英德里达松的系列名有两种写法（『埃伦迪尔探长系列』5 条／『埃伦迪尔探案系列』2 条），
 * `detective` 也分『埃伦迪尔』与『埃伦迪尔·斯韦恩松』——与作者名异写是同一类问题，只是发生在系列名上」。
 *
 * **为什么它比作者名分裂更值得修**：
 *   1. **推荐**按「系列」聚合（同系列作品被认为更相关），系列名一分裂，
 *      同一位侦探的两部作品会被算成两个系列；
 *   2. 详情页的「系列」一栏会显示成两个看起来无关的名字；
 *   3. 与作者名分裂一样，它也会**掩盖重复条目**（查重闸门按作者+题名比对，系列名不参与；
 *      但近似查重的「同系列同年」信号会失效）。
 *
 * 判据（只报告，不改数据）：
 *   ① **去尾词后同键**：把「探长／探案／侦探／系列／作品集／作品／探案集」这类尾词去掉后相同的系列名，
 *      如「埃伦迪尔探长系列」与「埃伦迪尔探案系列」→ 都以「埃伦迪尔」为干；
 *   ② **互为前后缀**：如「××系列」与「××系列（短篇集）」；
 *   ③ **同一系列内的主角名不一致**：同一系列下 `detective` 有多种写法。
 *
 * 用法：
 *   node scripts/audit-series-names.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';

/** 系列名归一：去掉尾部的体裁词，只留系列干 */
const core = (s) =>
  String(s || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[·・\s:：\-—]/g, '')
    .replace(/(探案集|探案系列|探长系列|侦探系列|探案|探长|侦探|悬疑推理作品|悬疑推理|系列|作品集|作品|丛书|书系)+$/g, '')
    .trim();

const files = readdirSync('data/books').filter((x) => x.endsWith('.json') && !x.startsWith('_'));
const books = [];
for (const f of files) for (const b of JSON.parse(readFileSync(`data/books/${f}`, 'utf8'))) books.push(b);

/** 只看「有意义」的系列：非空、不是「非系列」这类占位值、且至少 2 部 */
const seriesOf = (b) => {
  const s = String(b.series || '').trim();
  if (!s || /^(非系列|无|—)/.test(s)) return null;
  return s;
};

const bySeries = new Map();
for (const b of books) {
  const s = seriesOf(b);
  if (!s) continue;
  if (!bySeries.has(s)) bySeries.set(s, []);
  bySeries.get(s).push(b);
}

console.log('\n  系列名／主角名异写扫描');
console.log('  ────────────────────────────────────────────');
console.log(`  有条目的系列 ${bySeries.size} 个（另有非系列/空 ${books.filter((b) => !seriesOf(b)).length} 条）\n`);

/** ① 去尾词后同键 */
const byCore = new Map();
for (const [s, arr] of bySeries) {
  const k = core(s);
  if (k.length < 2) continue;
  if (!byCore.has(k)) byCore.set(k, []);
  byCore.get(k).push([s, arr]);
}
const g1 = [...byCore.entries()].filter(([, v]) => v.length > 1);

console.log(`  ① 去尾词后同干（同一系列被写成多个名字）：${g1.length} 组`);
for (const [k, v] of g1) {
  console.log(`    干「${k}」`);
  for (const [s, arr] of v) console.log(`        ${s}（${arr.length} 部）`);
  // 顺带看该组的 detective 写法
  const det = new Map();
  for (const [, arr] of v) for (const b of arr) det.set(b.detective || '（空）', (det.get(b.detective || '（空）') || 0) + 1);
  if (det.size > 1) console.log(`        ★ 主角写法也不一致：${[...det.entries()].map(([d, n]) => `${d}×${n}`).join(' ／ ')}`);
}

/** ② 互为前后缀 */
const names = [...bySeries.keys()];
const g2 = [];
for (const a of names) {
  for (const b of names) {
    if (a === b) continue;
    const ca = core(a);
    const cb = core(b);
    if (!ca || !cb || ca === cb) continue;
    const [short, long] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
    if (short.length >= 3 && long.includes(short)) g2.push([a, b]);
  }
}
console.log(`\n  ② 互为前后缀（多为「系列」与「系列（短篇集）」之别）：${g2.length} 组`);
for (const [a, b] of g2.slice(0, 20)) console.log(`       ${a}（${bySeries.get(a).length}）↔ ${b}（${bySeries.get(b).length}）`);
if (g2.length > 20) console.log(`      ……另有 ${g2.length - 20} 组`);

/** ③ 同一系列内主角名不一致（系列名本身没问题的那些） */
console.log('\n  ③ 同一系列内主角名写法不一致：');
let n3 = 0;
for (const [s, arr] of bySeries) {
  if (arr.length < 3) continue;
  const det = new Set(arr.map((b) => b.detective || '').filter(Boolean));
  if (det.size <= 1) continue;
  // 只有「一个名字是另一个的前缀」这类才报，避免把「多主角」当成问题
  const list = [...det];
  const variant = list.some((x) => list.some((y) => x !== y && y.includes(x)));
  if (!variant) continue;
  n3 += 1;
  console.log(`      ${s}（${arr.length} 部）：${list.map((d) => `${d}×${arr.filter((b) => b.detective === d).length}`).join(' ／ ')}`);
}
if (!n3) console.log('      （未发现）');

console.log('\n  提示：确认后用 `scripts/register-aliases.mjs` 归一（该脚本现有「作者名归一」表，');
console.log('        系列名归一可照同一模式加一张表），**改完紧接着跑 `find-duplicates.mjs --strict`**。\n');
