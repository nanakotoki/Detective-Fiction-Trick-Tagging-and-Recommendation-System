#!/usr/bin/env node
/**
 * 候选池「还没处理的」统计器 `pool-left`
 * ======================================
 * **为什么要从 `_dd` 里的一次性脚本搬进 `scripts/`**：候选池的余量是每轮选组的依据，
 * 但它此前只存在于 `_dd/_left.mjs`（未入库的临时脚本）里，而且**扣的东西不全**——
 * 只扣库内题名与 `data/exclusions.json`，于是「台账里早就判过不收」的候选每轮都会
 * 再报一次（§119 记过这个教训：结论要落在数据上，不能只落在叙述里）。
 *
 * 现在一次扣三样：
 *   ① 库内题名与别名（`data/books/**`）；
 *   ② 口径排除项（`data/exclusions.json`：纯恐怖／纯间谍不收）；
 *   ③ **已分诊但不另立条目的候选**（`data/not-collected.json`：多人选集、他人作品、
 *      期刊、盲文版、证据不足待核……每条带轮次与理由）。
 *
 * 题名归一用 `scripts/lib/dup-rules.mjs` 的 `normText`（繁简＋标点），
 * **刻意不做「第 N 辑」这类宽松剥除**——那种剥法会把《2012年中国侦探推理小说精选 第1辑》
 * （盲文版）和正册混成一条（§120.5 记过这个副作用）。盲文版现在由 `not-collected.json` 明确扣掉。
 *
 * 用法：
 *   node scripts/pool-left.mjs                 # 余量总览 + 前 20 位作者
 *   node scripts/pool-left.mjs --top 40        # 看前 40 位
 *   node scripts/pool-left.mjs --author 程小青  # 打印某位作者的全部余量
 *   node scripts/pool-left.mjs --file _dd/shlib-new.tsv --json _dd/left.json
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { normText } from './lib/dup-rules.mjs';

const argv = process.argv.slice(2);
const opt = (k, d = null) => {
  const i = argv.indexOf(k);
  return i === -1 ? d : argv[i + 1];
};
const POOL = opt('--file', '_dd/shlib-new.tsv');
const TOP = Number(opt('--top', '20'));
const ONLY = opt('--author', '');
const JSON_OUT = opt('--json', '');
/** `--mystery`：只保留**硬判据**行（主题词含「推理」或「侦探」）——按丛编扫来的行里混着非推理书 */ 
const MYSTERY = argv.includes('--mystery');

if (!existsSync(POOL)) {
  console.error(`✗ 找不到候选池文件 ${POOL}（由 scripts/shlib-author-scan.mjs 生成）`);
  process.exit(1);
}

// ── ① 库内题名（含又名）────────────────────────────────────────────
const inDb = new Set();
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  const arr = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  if (!Array.isArray(arr)) continue;
  for (const b of arr) {
    inDb.add(normText(b.title));
    for (const a of b.alternateTitles || []) inDb.add(normText(a));
  }
}

// ── ② 口径排除项 ───────────────────────────────────────────────────
const excluded = new Set(
  JSON.parse(readFileSync('data/exclusions.json', 'utf8')).titles.map((t) => normText(t.title)),
);

// ── ③ 已分诊但不另立条目的候选 ─────────────────────────────────────
const notCollectedRaw = JSON.parse(readFileSync('data/not-collected.json', 'utf8'));
const notCollected = new Map(
  (notCollectedRaw.items || []).map((it) => [normText(it.title), it]),
);

// ── 候选池 ────────────────────────────────────────────────────────
const rows = readFileSync(POOL, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .slice(1)
  .map((l) => l.split('\t'))
  // 断点续跑的标记行要跳过（`shlib-author-scan` / `shlib-series-scan` 都会写 `__DONE__` 行）
  .filter((c) => c[1] !== '__DONE__');

const left = [];
const dropped = { db: 0, excluded: 0, notCollected: 0, notMystery: 0 };
for (const c of rows) {
  const key = normText(c[1]);
  if (!key) continue;
  if (inDb.has(key)) { dropped.db += 1; continue; }
  if (excluded.has(key)) { dropped.excluded += 1; continue; }
  if (notCollected.has(key)) { dropped.notCollected += 1; continue; }
  // 主题词是第 7 列；两个池（作者池／丛编池）在这一列上一致
  if (MYSTERY && !/推理|侦探/.test(c[6] || '')) { dropped.notMystery += 1; continue; }
  left.push(c);
}

const byAuthor = new Map();
for (const c of left) {
  if (!byAuthor.has(c[0])) byAuthor.set(c[0], []);
  byAuthor.get(c[0]).push(c);
}
const groups = [...byAuthor.entries()].sort((a, b) => b[1].length - a[1].length);

console.log('');
console.log(`  候选池 ${POOL}：${rows.length} 行`);
console.log(`  已扣：库内题名／别名 ${dropped.db} 行 ｜ 口径排除项 ${dropped.excluded} 行 ｜ 已判不另立条目 ${dropped.notCollected} 行${MYSTERY ? ` ｜ 非推理主题词 ${dropped.notMystery} 行` : ''}`);
console.log(`  ────────────────────────────────────────────`);
console.log(`  尚余 ${left.length} 条 / ${groups.length} 位作者`);
console.log('');

if (ONLY) {
  const g = groups.find(([a]) => a === ONLY);
  if (!g) {
    console.log(`  （${ONLY} 没有余量）`);
  } else {
    console.log(`  ${ONLY}（${g[1].length} 条）：`);
    for (const c of g[1]) console.log(`     《${c[1]}》 ｜ ${c[4]} ${c[5]} ｜ ${c[3]} ｜ ${c[6]}`);
  }
} else {
  for (const [a, arr] of groups.slice(0, TOP)) {
    console.log(`  ${String(arr.length).padStart(4)}  ${a}  ${arr.slice(0, 6).map((c) => c[1]).join('、')}`);
  }
  if (groups.length > TOP) console.log(`  …（其余 ${groups.length - TOP} 位作者的余量都在 ${groups[TOP] ? groups[TOP][1].length : 0} 条以下）`);
}

if (JSON_OUT) {
  writeFileSync(
    JSON_OUT,
    JSON.stringify({ total: left.length, groups: groups.map(([author, arr]) => ({ author, count: arr.length, titles: arr.map((c) => c[1]) })) }, null, 2) + '\n',
    'utf8',
  );
  console.log(`\n  （明细 → ${JSON_OUT}）`);
}
