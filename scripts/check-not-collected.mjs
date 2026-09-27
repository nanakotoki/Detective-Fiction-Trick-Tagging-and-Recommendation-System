#!/usr/bin/env node
/**
 * 「已分诊但不另立条目」数据文件的闸门 `check-not-collected`
 * ==========================================================
 * `data/not-collected.json` 收录**台账里判过、但本库不另立条目**的候选：
 * 多人选集、他人作品（译者被著录成主要责任者）、期刊辑刊、盲文版、题材不符、证据不足待核……
 * 每条带**轮次**与**理由**。它的作用有两个：
 *
 *   ① 让候选池的「尚余」是**真的待办**（`scripts/pool-left.mjs` 会扣掉这里的题名）——
 *      此前这些结论只写在台账的表格里，机器读不到，同一批候选每轮都要重新分诊一遍
 *      （§119 记过这个教训，§120 一次就写出 19 条这样的结论）；
 *   ② 反过来当**回归闸门**：一旦哪一轮把这里列过的题名又收进了库，本脚本报错——
 *      §116 的《帕诺拉马岛绮谭》就是这么被当成新书收进去的。
 *
 * 校验项：
 *   · 字段齐全（title / author / status / round / reason），status ∈ {不收, 待核}
 *   · 同一题名不重复登记
 *   · **与库内不矛盾**：命中的题名若已在本库（题名或又名）→ 错误（要么撤回条目，要么改这里）
 */
import { readFileSync, readdirSync } from 'node:fs';
import { normText } from './lib/dup-rules.mjs';

const C = { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m', reset: '\x1b[0m' };
const STATUS = new Set(['不收', '待核']);

const data = JSON.parse(readFileSync('data/not-collected.json', 'utf8'));
const items = data.items || [];
const errors = [];
const warnings = [];

const seen = new Map();
for (const [i, it] of items.entries()) {
  const where = `items[${i}]《${it?.title ?? '?'}》`;
  if (!it || typeof it !== 'object') { errors.push(`${where}: 不是对象`); continue; }
  if (!String(it.title || '').trim()) errors.push(`${where}: 缺 title`);
  if (!String(it.author || '').trim()) errors.push(`${where}: 缺 author`);
  if (!STATUS.has(it.status)) errors.push(`${where}: status 必须是「不收」或「待核」（当前「${it.status}」）`);
  if (!Number.isInteger(it.round) || it.round <= 0) errors.push(`${where}: round 必须是正整数轮次`);
  if (!String(it.reason || '').trim()) errors.push(`${where}: 缺 reason（理由必须写下来，否则下一轮还得再看一遍）`);
  const key = normText(it.title);
  if (seen.has(key)) errors.push(`${where}: 与 items[${seen.get(key)}] 题名重复`);
  else seen.set(key, i);
}

// 与库内对照：这里列过的题名不该出现在库里
const inDb = new Map();
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  const arr = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  if (!Array.isArray(arr)) continue;
  for (const b of arr) {
    for (const t of [b.title, ...(b.alternateTitles || [])]) {
      const k = normText(t);
      if (k && !inDb.has(k)) inDb.set(k, { title: b.title, file: f });
    }
  }
}
const clashes = [];
for (const it of items) {
  const hit = inDb.get(normText(it.title));
  if (hit) clashes.push({ item: it, hit });
}
for (const { item, hit } of clashes) {
  errors.push(
    `《${item.title}》登记为「${item.status}」（第 ${item.round} 轮），却已在库内（《${hit.title}》，${hit.file}）——` +
      '要么撤回该条目，要么从本文件里删掉这一条',
  );
}

const count = (s) => items.filter((it) => it.status === s).length;
const rounds = [...new Set(items.map((it) => it.round))].sort((a, b) => a - b);

console.log('');
console.log(C.bold + '  已分诊但不另立条目 · 数据闸门' + C.reset);
console.log(C.dim + '  ────────────────────────────────────────────' + C.reset);
console.log(`  条目 ${items.length} 条：不收 ${count('不收')} ｜ 待核 ${count('待核')} ｜ 覆盖轮次 ${rounds.join('、')}`);
if (warnings.length) for (const w of warnings) console.log(`  ${C.dim}! ${w}${C.reset}`);
if (clashes.length) for (const { item, hit } of clashes) console.log(`  ${C.red}✗ 《${item.title}》 ↔ 库内《${hit.title}》${C.reset}`);

if (errors.length) {
  console.log('');
  for (const e of errors) console.log(`  ${C.red}✗ ${e}${C.reset}`);
  console.log(`\n  ${C.red}${C.bold}✗ 未通过：${errors.length} 项错误${C.reset}\n`);
  process.exit(1);
}
console.log(`\n  ${C.green}✓ 通过：结构合法，且没有一条与库内条目冲突${C.reset}\n`);
