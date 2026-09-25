/**
 * 两馆并查取证（对外经贸大学 OPAC + 重庆工商大学 OPAC）
 * ====================================================
 * 两馆同族著录、入藏范围互补（例如《求婚的密室》只有 ctbu 有，《爱丽丝梦境事件》只有对外经贸有），
 * 所以按书名取证时**两个馆都问一遍**，取第一个有精确题名命中的记录。
 *
 * 用法：
 *   node scripts/opac2-verify.mjs --title 赫尔克里·波洛的丰功伟绩 [--title …]
 *   node scripts/opac2-verify.mjs --title X --site ctbu      只问一个馆
 */
import { SITES, detail, search, subjectVerdict } from './lib/uibe.mjs';

const argv = process.argv.slice(2);
const take = (name) => {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === `--${name}`) out.push(argv[i + 1]);
  return out;
};
const titles = take('title');
const only = take('site')[0];
const loose = argv.includes('--loose');
const sites = only ? [only] : Object.keys(SITES);

if (!titles.length) {
  console.error('用法: node scripts/opac2-verify.mjs --title <书名> [--title …] [--site uibe|ctbu]');
  process.exit(1);
}

let found = 0;
let mystery = 0;

for (const t of titles) {
  console.log(`\n########## ${t}`);
  for (const site of sites) {
    let rows = [];
    let count = null;
    try {
      ({ rows, count } = await search(t, { site }));
    } catch (e) {
      console.log(`  [${SITES[site].label}] 检索失败：${e.message}`);
      continue;
    }
    const exact = rows.filter((r) => r.title === t);
    console.log(`  [${SITES[site].label}] 共 ${count ?? '?'} 条，题名完全相等 ${exact.length} 条`);
    if (loose && !exact.length) {
      console.log('     （--loose：列出前 5 条供人工确认题名写法）');
      for (const r of rows.slice(0, 5)) console.log(`     · ${r.title} | ${r.author} | ${r.publisher}`);
    }
    for (const r of exact) {
      console.log(`     · ${r.title} | ${r.author} | ${r.publisher}`);
      console.log(`       主题词：${r.subjects.join(' / ') || '-'}`);
      try {
        const d = await detail(r.bookId, { site });
        const v = subjectVerdict(d.subjects);
        console.log(`       题名主题：${d.subjects || '-'}  → 推理？${v.mystery ? '是' : '否'}`);
        console.log(`       丛编项：${d.series || '-'}`);
        console.log(`       相关题名附注：${d.titleNote || '-'}`);
        console.log(`       中图分类：${d.clc || '-'}   出版发行项：${d.imprint || '-'}`);
        console.log(`       提要文摘：${(d.abstract || '-').slice(0, 320)}`);
        found++;
        if (v.mystery) mystery++;
      } catch (e) {
        console.log(`       详情失败：${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    await new Promise((r) => setTimeout(r, 700));
  }
}

console.log(`\n合计取到著录 ${found} 条，其中学科主题直证推理 ${mystery} 条`);
