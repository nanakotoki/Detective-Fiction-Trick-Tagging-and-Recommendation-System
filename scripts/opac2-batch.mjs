/**
 * 批量编目取证（两馆）
 * ====================
 * 上一节把丛书候选筛出来了（`_dd/series-gap.tsv`，201 个题名），但**候选不是结论**：
 * 当当没有中图法与学科主题，每一条都必须回到编目源取题材判据。
 * 逐条手敲 `opac2:verify` 太慢，所以这里做批量版：对每个题名
 *   ①问对外经贸 OPAC，题名完全相等则取详情；②没有就再问重庆工商 OPAC；
 * 把「题名主题 / 丛编项 / 相关题名附注 / 出版发行项 / 提要文摘」压成一行 TSV。
 *
 * 随即筛选：`subjects` 含「推理小说／侦探小说」的是**硬判据**（可直接入库）；
 * 只有丛编项可依的属**弱判据**，需人工在条目里写明。
 *
 * ⚠️ 两馆都是**别人学校的服务器**。默认 900ms 间隔、并发 1、带熔断；
 * 历史上把原馆藏 OPAC 全量扫挂过一次，这里宁可慢。
 *
 * 用法：
 *   node scripts/opac2-batch.mjs --tsv _dd/series-gap.tsv --col 2 --out _dd/verify.tsv
 *   node scripts/opac2-batch.mjs --file titles.txt --out _dd/verify.tsv
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { SITES, detail, search, subjectVerdict, uibeHealth } from './lib/uibe.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = '') => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const tsvIn = opt('tsv');
const col = Number(opt('col', '2'));
const fileIn = opt('file');
const out = opt('out', '_dd/verify.tsv');
const delay = Number(opt('delay', '900'));
const limit = Number(opt('limit', '0'));

let titles = [];
if (tsvIn) {
  titles = readFileSync(tsvIn, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => (l.split('\t')[col - 1] ?? '').trim());
} else if (fileIn) {
  titles = readFileSync(fileIn, 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
} else {
  console.error('用法: node scripts/opac2-batch.mjs --tsv <文件> [--col 2] | --file <清单> [--out 输出]');
  process.exit(1);
}

// 去重 + 续抓（输出文件里已有的题名不再重复问）
titles = [...new Set(titles)].filter(Boolean);
const seen = new Set();
if (existsSync(out)) {
  for (const line of readFileSync(out, 'utf8').split(/\r?\n/)) {
    if (line.trim()) seen.add(line.split('\t')[0]);
  }
  if (seen.size) console.log(`续抓：已有 ${seen.size} 条`);
}
if (limit) titles = titles.slice(0, limit);

const clean = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

let hit = 0;
let hard = 0;
let i = 0;
for (const t of titles) {
  i++;
  if (seen.has(t)) continue;
  let row = null;
  for (const site of Object.keys(SITES)) {
    let rows = [];
    try {
      ({ rows } = await search(t, { site }));
    } catch (e) {
      console.log(`  [${i}/${titles.length}] ${t} @${site} 检索失败：${e.message}`);
      break;
    }
    const exacts = rows.filter((r) => r.title === t);
    if (!exacts.length) continue;
    // ⚠️ 同一个书名在同一馆常有多条著录（不同版本/不同编目批次），**它们的题名主题并不一致**：
    // 有的标了「侦探小说」，有的只标「长篇小说」。早期版本只看第一条，于是把
    // 《意外来客》《黑咖啡》《天涯过客》这类**本来有硬判据**的书误判成「弱判据」。
    // 现在最多看 3 条，取主题词里**含推理/侦探的那一条**优先。
    let best = null;
    for (const cand of exacts.slice(0, 3)) {
      try {
        const d = await detail(cand.bookId, { site });
        const v = subjectVerdict(d.subjects);
        const row2 = {
          title: t,
          site,
          verdict: v.mystery ? '硬判据' : d.series ? '弱判据(丛编)' : '无判据',
          subjects: clean(d.subjects),
          series: clean(d.series),
          note: clean(d.titleNote),
          imprint: clean(d.imprint),
          abstract: clean(d.abstract).slice(0, 220),
        };
        if (!best || (row2.verdict === '硬判据' && best.verdict !== '硬判据')) best = row2;
        if (best.verdict === '硬判据') break; // 已取到最硬的判据，不必再问
      } catch (e) {
        console.log(`  [${i}/${titles.length}] ${t} @${site} 详情失败：${e.message}`);
      }
      await new Promise((r) => setTimeout(r, delay));
    }
    row = best;
  }
  const line = row
    ? [row.title, row.site, row.verdict, row.subjects, row.series, row.note, row.imprint, row.abstract].join('\t')
    : [t, '-', '未入藏/无著录', '', '', '', '', ''].join('\t');
  appendFileSync(out, line + '\n', 'utf8');
  seen.add(t);
  if (row) {
    hit++;
    if (row.verdict === '硬判据') hard++;
  }
  const mark = row ? (row.verdict === '硬判据' ? '★' : '·') : '×';
  console.log(`${mark} [${i}/${titles.length}] ${t}  ${row ? row.subjects || row.series : '未入藏'}`);
  await new Promise((r) => setTimeout(r, delay));
}

console.log(`\n共处理 ${seen.size} 个题名：取到著录 ${hit} 条，其中学科主题直证推理 ${hard} 条`);
console.log(`熔断计数 ${uibeHealth.fails}/${uibeHealth.limit}；结果：${out}`);
