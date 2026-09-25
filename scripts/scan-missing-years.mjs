#!/usr/bin/env node
/**
 * 批量补出版年（用当当）
 * ======================
 * 背景：`audit:offline` 之外的一次盘点发现全库有 80+ 部没填 `firstPublished`。
 * 豆瓣整站 403、馆藏 OPAC 拒连时，当当是唯一还能取到出版信息的来源。
 *
 * **只写报告，不改知识库**：扫描结果落到 `data/_missing-years.tsv`，
 * 由人工逐条确认后再写回。理由与泄底闸门同理——自动写回会绕过人工核对，
 * 而「出版年填错」正是本项目反复踩过的坑（《冥海之》再版年、《刀锋上的救赎》再版年都错过）。
 *
 * ⚠️ 判据从紧：
 *   · **只认题名精确匹配**（当当检索是模糊的，查「一具尸体太多」会返回几十条无关书）；
 *   · 同一书名若匹配到**多个不同年份**，一律标 `conflict` 并在报告里列出全部候选，
 *     不自动取第一个——不同年份可能是不同版本，选错就把再版年当成了首版年。
 *
 * 用法：node scripts/scan-missing-years.mjs [--limit N]
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { search, parseAuthorLine } from './lib/dangdang.mjs';

const DIR = 'data/books';
const OUT = 'data/_missing-years.tsv';

const argv = process.argv.slice(2);
const li = argv.indexOf('--limit');
const limit = li !== -1 ? Number(argv[li + 1]) : 0;

const targets = [];
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  for (const b of JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))) {
    if (!String(b.firstPublished || '').trim()) targets.push({ file: f, ...b });
  }
}
console.log(`\n  缺 firstPublished 的条目：${targets.length} 部`);
const todo = limit ? targets.slice(0, limit) : targets;
console.log(`  本次扫描 ${todo.length} 部（每题名一次检索，请耐心等）\n`);

const rows = [];
let hitOne = 0;
let hitConflict = 0;
let miss = 0;

for (const [i, b] of todo.entries()) {
  const label = `[${String(i + 1).padStart(3)}/${todo.length}]`;
  let res;
  try {
    res = await search(b.title);
  } catch (e) {
    console.log(`${label} 《${b.title}》 检索失败：${e.message}`);
    rows.push({ ...b, status: 'error', year: '', date: '', publisher: '', candidates: String(e.message) });
    continue;
  }
  const exact = res.exactTitleMatches;
  if (!exact.length) {
    miss += 1;
    console.log(`${label} 《${b.title}》 —— 当当无精确命中（模糊结果 ${res.rows.length} 条，不予采信）`);
    rows.push({ ...b, status: 'miss', year: '', date: '', publisher: '', candidates: '' });
    continue;
  }

  /**
   * **必须再用作者过滤一遍**：光是题名相同远远不够。
   * 实际例子——《魔都》那一条精确命中 60 来个版本，里面混着**村松梢风的同名书**
   * （与本库收的久生十兰《魔都》是两本完全不同的书），项目早前就在这个坑上栽过。
   * 所以只有当结果行的责任者里出现本条目作者时，才认这条候选。
   */
  const byAuthor = exact.filter((r) => b.author && r.authorLine.includes(b.author));
  const pool = byAuthor.length ? byAuthor : [];
  if (!pool.length) {
    miss += 1;
    console.log(
      `${label} 《${b.title}》 —— 题名精确命中 ${exact.length} 条，但**没有一条的责任者含「${b.author}」**，` +
        `拒绝据此填空（很可能是同名他人的书）`
    );
    rows.push({ ...b, status: 'author-mismatch', year: '', date: '', publisher: '', candidates: `${exact.length}条` });
    continue;
  }

  const parsed = pool.map((r) => ({ id: r.id, ...parseAuthorLine(r.authorLine) })).filter((x) => x.year);
  const years = [...new Set(parsed.map((x) => x.year))];
  if (!years.length) {
    miss += 1;
    console.log(`${label} 《${b.title}》 —— 作者相符的精确命中 ${pool.length} 条，但行内没有出版日期`);
    rows.push({ ...b, status: 'nodate', year: '', date: '', publisher: '', candidates: pool.map((r) => r.id).join(',') });
    continue;
  }
  if (years.length > 1) {
    hitConflict += 1;
    // 按年份统计条数：多数候选一致时，把「多数年」与「少数年」都列出来供人工判断
    const tally = {};
    for (const x of parsed) tally[x.year] = (tally[x.year] || 0) + 1;
    const cand = Object.entries(tally)
      .sort((a, c) => c[1] - a[1])
      .map(([y, n]) => `${y}×${n}`)
      .join(' ');
    console.log(`${label} 《${b.title}》 ⚠ 作者相符但年份不止一个：${cand}`);
    rows.push({ ...b, status: 'conflict', year: '', date: '', publisher: '', candidates: cand });
    continue;
  }
  hitOne += 1;
  const first = parsed[0];
  console.log(`${label} 《${b.title}》 → ${first.year}　${first.publisher || ''}　（${first.date}）`);
  rows.push({ ...b, status: 'ok', year: first.year, date: first.date, publisher: first.publisher, candidates: `${exact.length}条` });

  await new Promise((r) => setTimeout(r, 300));
}

const header =
  '# 缺出版年条目的当当选修结果（生成：node scripts/scan-missing-years.mjs）\n' +
  '# status: ok=唯一年份可采信 / conflict=匹配到多个年份需人工判断 / nodate=有书无日期 / miss=无精确命中 / error=检索失败\n' +
  '# 列：status \\t 条目id \\t 书名 \\t 作者 \\t 文件 \\t 年份 \\t 日期 \\t 出版社 \\t 候选\n';
const body = rows
  .map((r) =>
    [r.status, r.id, r.title, r.author, r.file, r.year, r.date, r.publisher || '', r.candidates || ''].join('\t')
  )
  .join('\n');
writeFileSync(OUT, `${header}${body}\n`, 'utf8');

console.log(
  `\n  合计：可直接采信 ${hitOne} 部；多版本待判 ${hitConflict} 部；无精确命中／无日期 ${miss} 部。` +
    `\n  ✓ 报告已写出 ${OUT}——**本轮不改知识库**，请人工确认后再写回。\n`
);
