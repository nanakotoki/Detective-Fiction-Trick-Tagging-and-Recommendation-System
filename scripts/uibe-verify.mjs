/**
 * 编目取证（对外经贸大学 OPAC）
 * ==============================
 * 用途：给一部书（或一个作者）取**最硬的题材判据**——学科主题词「推理小说/侦探小说」、
 * 中图法分类号、丛编项、以及原题名（相关题名附注）。
 *
 * 用法：
 *   node scripts/uibe-verify.mjs --title 爱丽丝梦境事件 [--title ...]
 *   node scripts/uibe-verify.mjs --author 二阶堂黎人 [--author ...]
 *   node scripts/uibe-verify.mjs --isbn 9787533977412
 *   node scripts/uibe-verify.mjs --title X --detail=no     只列表不取详情
 *
 * 为什么标题检索之后还要取详情：结果行里的「主题词」是分面截断后的展示，
 * 只有详情页的「题名主题」才是完整著录，题材判定以它为准。
 */
import { search, searchAll, detail, subjectVerdict, uibeHealth } from './lib/uibe.mjs';

const argv = process.argv.slice(2);
const take = (name) => {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === `--${name}`) out.push(argv[i + 1]);
  return out;
};
const flag = (name) => argv.includes(`--${name}`);

const titles = take('title');
const authors = take('author');
const isbns = take('isbn');
const withDetail = !flag('no-detail') && !argv.includes('--detail=no');
const max = Number(take('max')[0] || 200);

if (!titles.length && !authors.length && !isbns.length) {
  console.error(
    '用法: node scripts/uibe-verify.mjs --title <书名> | --author <作者> | --isbn <isbn> [--no-detail] [--max N]'
  );
  process.exit(1);
}

function showRow(r, n) {
  console.log(`  ${String(n).padStart(2)}. ${r.title}`);
  console.log(`      著者：${r.author || '-'}`);
  console.log(`      出版：${r.publisher || '-'}`);
  console.log(`      索书号：${r.callNumber || '-'}   ISBN：${r.isbn || '-'}`);
  console.log(`      主题词：${r.subjects.join(' / ') || '-'}`);
}

let hitTotal = 0;
let mysteryTotal = 0;

for (const t of titles) {
  console.log(`\n########## 题名检索：${t}`);
  try {
    // 注意：这个 OPAC 的 field 参数并不过滤（creatorSearch/titleSearch 都只是改变排序），
    // 但**精确书名会排在第 1 条**，所以取「题名完全相等」的行即可。
    const { rows, count } = await search(t, { field: '' });
    console.log(`  共 ${count ?? '?'} 条，本页 ${rows.length} 条`);
    const exact = rows.filter((x) => x.title === t);
    console.log(`  题名完全相等的 ${exact.length} 条`);
    for (const [i, r] of (exact.length ? exact : rows).entries()) showRow(r, i + 1);
    if (withDetail) {
      for (const r of exact) {
        const d = await detail(r.bookId);
        const v = subjectVerdict(d.subjects);
        console.log(`  ── 详情（${r.bookId}）`);
        console.log(`     题名责任者项：${d.titleAuthor || '-'}`);
        console.log(`     出版发行项：${d.imprint || '-'}`);
        console.log(`     丛编项：${d.series || '-'}`);
        console.log(`     相关题名附注：${d.titleNote || '-'}`);
        console.log(`     题名主题：${d.subjects || '-'}   → 推理？${v.mystery ? '是' : '否'}（${v.why}）`);
        console.log(`     中图分类：${d.clc || '-'}   索书号：${d.callNumber || '-'}`);
        console.log(`     提要文摘：${(d.abstract || '-').slice(0, 400)}`);
        hitTotal++;
        if (v.mystery) mysteryTotal++;
      }
    }
  } catch (e) {
    console.log(`  失败：${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 800));
}

for (const a of authors) {
  console.log(`\n########## 著者枚举：${a}`);
  try {
    const { rows, count } = await searchAll(a, { field: 'creatorSearch', max, verbose: true });
    const mine = rows.filter((r) => r.author.includes(a));
    console.log(`  共 ${count} 条，取回 ${rows.length} 条，著者含「${a}」的 ${mine.length} 条：`);
    for (const [i, r] of mine.entries()) showRow(r, i + 1);
  } catch (e) {
    console.log(`  失败：${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 800));
}

for (const i of isbns) {
  console.log(`\n########## ISBN 检索：${i}`);
  try {
    const { rows } = await search(i, { field: 'isbnSearch' });
    console.log(`  本页 ${rows.length} 条`);
    for (const [n, r] of rows.entries()) showRow(r, n + 1);
    const hit = rows.find((r) => (r.isbn || '').replace(/-/g, '').includes(i.replace(/-/g, '')));
    if (hit && withDetail) {
      const d = await detail(hit.bookId);
      const v = subjectVerdict(d.subjects);
      console.log(`  ── 详情：题名主题「${d.subjects || '-'}」→ 推理？${v.mystery ? '是' : '否'}`);
      console.log(`     丛编项：${d.series || '-'}   相关题名附注：${d.titleNote || '-'}`);
    }
  } catch (e) {
    console.log(`  失败：${e.message}`);
  }
}

console.log(`\n合计判定 ${hitTotal} 条，其中推理 ${mysteryTotal} 条；熔断计数 ${uibeHealth.fails}/${uibeHealth.limit}`);
