#!/usr/bin/env node
/**
 * 评分来源写法归一 `unify-rating-source`
 * ======================================
 * 起因（台账 §107.1、§109）：豆瓣条目页的来源在这两年里换过三次：
 *   · 早年（桌面站可用）：`apply-ratings.mjs` 写 `豆瓣读书（实时抓取）`；
 *   · 2026-09 桌面站整站 403 之后：新条目改走移动版，`make-batch.mjs` 写
 *     `豆瓣读书（移动版条目页实时抓取）`，摘要写「豆瓣移动版条目页评分 X。」；
 *   · 2026-09 桌面站恢复（§107）后：两条路都通，写哪个只取决于**当时用了哪个脚本**。
 *
 * 但 `source` 是**机器可读的字段**，读者与检查脚本都按它分类统计：
 * 同一件事（「这条评分是实时从豆瓣条目页抓的」）有几种写法，就会出现
 * 「明明都抓到了，统计里却分成两栏」这种查不出来的错。
 *
 * 因此本工具把**同一件事**的写法收敛成一种：
 *   · `source` 统一为 `豆瓣读书（实时抓取）`（与 `apply-ratings.mjs` 一致）；
 *   · `summary` 里的「豆瓣移动版条目页评分 X。」改为「豆瓣条目页评分 X。」——
 *     渠道细节由 `sourceUrl` 与抓取时间负责，摘要只留「这是抓来的分」。
 *
 * ⚠️ **只动这两处**：评分、评价人数、`sourceUrl`、`fetchedAt`、`edition` 一律不碰；
 * 条目 `verification.source` 里那句「评分与梗概来源：豆瓣移动版条目页…」是**当时的记录**，
 * 属于历史，不改（改了反而看不出这条当初是怎么来的）。
 *
 * 用法：
 *   node scripts/unify-rating-source.mjs            # 干跑，只报告
 *   node scripts/unify-rating-source.mjs --apply    # 写入
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const CANONICAL_SOURCE = '豆瓣读书（实时抓取）';
/** 同义写法：都表示「实时从豆瓣条目页抓取」 */
const SAME_MEANING = [
  '豆瓣读书（实时抓取）',
  '豆瓣读书（移动版条目页实时抓取）',
  '豆瓣读书（移动版实时抓取）',
];
const APPLY = process.argv.includes('--apply');

const files = readdirSync('data/books').filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const touched = [];
let changed = 0;

for (const f of files) {
  const arr = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  if (!Array.isArray(arr)) continue;
  let dirty = false;
  for (const b of arr) {
    const d = b.ratings?.douban;
    if (!d || d.score == null) continue;
    const beforeSource = d.source;
    const beforeSummary = d.summary;
    if (SAME_MEANING.includes(d.source) && d.source !== CANONICAL_SOURCE) {
      d.source = CANONICAL_SOURCE;
    }
    if (typeof d.summary === 'string' && /豆瓣移动版(条目页)?评分/.test(d.summary)) {
      d.summary = d.summary.replace(/豆瓣移动版(条目页)?评分/, '豆瓣条目页评分');
    }
    if (d.source !== beforeSource || d.summary !== beforeSummary) {
      dirty = true;
      changed += 1;
      console.log(
        `✓ 《${b.title}》（${b.id}）\n    source : ${beforeSource} → ${d.source}\n    summary: ${beforeSummary} → ${d.summary}`,
      );
      touched.push({ file: f, id: b.id, title: b.title });
    }
  }
  if (dirty && APPLY && arr.length) writeFileSync(`data/books/${f}`, JSON.stringify(arr, null, 2) + '\n', 'utf8');
}

// 反向自检：写完之后不应再有任何同义写法
const after = new Set();
for (const f of files) {
  const arr = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  if (!Array.isArray(arr)) continue;
  for (const b of arr) {
    const d = b.ratings?.douban;
    if (d?.score != null && SAME_MEANING.includes(d.source)) after.add(d.source);
  }
}
console.log(`\n共 ${changed} 条需要归一${APPLY ? '（已写入 ' + new Set(touched.map((t) => t.file)).size + ' 个文件）' : '（干跑，未写入）'}`);
console.log(`自检：实时抓取类条目的 source 现有写法 → ${[...after].join('、') || '（无）'}`);
if (after.size > 1) {
  console.error('✗ 仍有多种写法并存，请检查上面的清单');
  process.exit(1);
}
