#!/usr/bin/env node
/**
 * 按责任者枚举某位作者的全部馆藏（**不依赖豆瓣**）
 * ================================================
 * 为什么需要它：`docs/collection-backlog.md` 第九节记着一条根本限制——
 * **无法自动枚举某位作者的全部作品**，因为豆瓣的 `subject_suggest` 只按书名检索。
 * 而豆瓣一旦限流／跳登录（本项目已经历 429 与 403 两种），丛书枚举也一并失效。
 *
 * 图书馆 OPAC 的**责任者检索**正好补上这个洞：它按 `著者` 字段匹配，
 * 一次列出该作者在本馆的全部藏书（分页 20 条），**与豆瓣完全无关**。
 * 实测对译作同样有效（如「三津田信三」返回 20 条）。
 *
 * 用法：
 *   node scripts/opac-author.mjs 三津田信三
 *   node scripts/opac-author.mjs --detail 三津田信三     额外逐条取详情，给出中图法与主题词
 *   node scripts/opac-author.mjs --all                   对所有库内作者跑一遍（很慢，慎用）
 *   node scripts/opac-author.mjs --file scripts/_authors.txt
 *
 * ⚠️ 三条已知局限（判断结果时必须记住）：
 *   1. **馆藏不是全量**。冷门书、太新的书、地方出版物常常查不到；查不到**不等于没有**。
 *   2. **同名不同作者**。检索按著者字段匹配，但结果里可能混入同名者的书，
 *      所以每条都要核对责任者。
 *   3. **译名不同**。馆藏题名与库内题名可能是同一部书的两种译法，
 *      所以脚本对「一方包含另一方」的情况单列为「疑同书」，交人判断，不自动算新书。
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BASE, strip, get, parseList, detail, clcVerdict, opacHealth } from './lib/opac.mjs';

const BOOKS_DIR = 'data/books';

const argv = process.argv.slice(2);
const wantDetail = argv.includes('--detail');
const allMode = argv.includes('--all');
const quiet = argv.includes('--quiet');
const fi = argv.indexOf('--file');
const oi = argv.indexOf('--out');
/** 把「馆藏有、库内无」的候选写成 TSV（作者 / 书名 / 年 / 出版社 / 索书号 / marc），便于批量处理 */
const outFile = oi !== -1 ? argv[oi + 1] : '';

let authors = argv.filter((a, i) => !a.startsWith('--') && !(oi !== -1 && i === oi + 1));

/* ------------------------------------------------------------------ */
/* 知识库侧                                                            */
/* ------------------------------------------------------------------ */

function loadBooks() {
  const out = [];
  for (const f of readdirSync(BOOKS_DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
    for (const b of JSON.parse(readFileSync(`${BOOKS_DIR}/${f}`, 'utf8'))) out.push(b);
  }
  return out;
}

/**
 * 归一：去掉空白、标点、以及会随版本变化的括号内容，便于宽松比对。
 *
 * **必须先剥掉版本后缀**：馆藏题名常带「.第 2 版」「.2版」「（第3版）」这类标记，
 * 不剥就会把同一部书的第 2 版当成新书报出来（实测《向日葵不开的夏天.第3版》
 * 《解体诸因.2版》都会被误报）。
 */
const stripEdition = (s) =>
  String(s || '')
    .replace(/[.·]?\s*第?\s*\d+\s*版\s*$/g, '')
    .replace(/[（(【\[]\s*第?\s*\d+\s*版\s*[）)】\]]/g, '')
    .trim();

const normTitle = (s) =>
  stripEdition(s)
    .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '')
    .replace(/[\s·・:：,，.。、;；!！?？'"“”‘’—\-_/\\]/g, '')
    .toLowerCase();

/* ------------------------------------------------------------------ */
/* OPAC 侧                                                             */
/* ------------------------------------------------------------------ */

/** 按责任者检索并翻页，直到某页没有新条目 */
async function searchAuthor(author, { maxPages = 5 } = {}) {
  const seen = new Map();
  for (let page = 1; page <= maxPages; page++) {
    let html;
    try {
      html = await get(`${BASE}/openlink.php?author=${encodeURIComponent(author)}&page=${page}`);
    } catch (e) {
      return { rows: [...seen.values()], error: e.message, pages: page - 1 };
    }
    const rows = parseList(html);
    let added = 0;
    for (const r of rows) if (!seen.has(r.marc)) (seen.set(r.marc, r), added++);
    if (!rows.length || added === 0) return { rows: [...seen.values()], error: null, pages: page };
    await new Promise((r) => setTimeout(r, 400));
  }
  return { rows: [...seen.values()], error: null, pages: maxPages };
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

const books = loadBooks();

if (allMode) {
  authors = [...new Set(books.map((b) => b.author))].sort();
}
if (fi !== -1) {
  authors = readFileSync(argv[fi + 1], 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}
if (!authors.length) {
  console.log('\n  用法：node scripts/opac-author.mjs <作者名...> | --file <清单> | --all [--detail]\n');
  process.exit(1);
}

const byAuthor = new Map();
for (const b of books) {
  if (!byAuthor.has(b.author)) byAuthor.set(b.author, []);
  byAuthor.get(b.author).push(b);
}

/**
 * 熔断阈值：连续这么多次「一个作者都取不到」就整站停手。
 *
 * 起因是一次真实事故：`--all` 扫描 324 位作者时持续加压，把 opac.yzlib.cn
 * 打到整站拒连（`fetch failed`），连普通条目页也一起取不到，且因为结果只在
 * 结束时落盘，**跑了几十分钟的成果全丢了**。所以这里两道保险：
 *   1. 连续失败达到阈值立即中止，不再加压；
 *   2. **每处理完一位作者就把结果 flush 到磁盘**，中断也不丢已得的部分。
 */
const FAILURE_LIMIT = 12;

let totalNew = 0;
let totalMaybe = 0;
const collected = [];

const OUT_HEADER =
  '# 馆藏责任者扫描结果（生成：node scripts/opac-author.mjs --all --out <本文件>）\n' +
  '# kind=new 表示题名在库内找不到；kind=maybe 表示与库内某个题名互相包含，多半是同书异译，勿直接新增。\n' +
  '# 列：kind \\t 作者 \\t 书名 \\t 年 \\t 出版社 \\t 索书号 \\t marc \\t 疑同的库内题名\n';

const flush = (note = '') => {
  if (!outFile) return;
  const body = collected
    .map((r) =>
      [r.kind, r.author, String(r.name || '').trim(), r.year || '', r.pub || '', r.callno || '', r.marc, r.hit || ''].join('\t')
    )
    .join('\n');
  writeFileSync(outFile, `${OUT_HEADER}${note}${body}\n`, 'utf8');
};

opacHealth.reset();
let aborted = null;

for (const author of authors) {
  const mine = byAuthor.get(author) || [];
  const known = new Set();
  for (const b of mine) {
    known.add(normTitle(b.title));
    for (const t of b.alternateTitles || []) known.add(normTitle(t));
  }
  const knownList = [...known].filter(Boolean);

  if (!quiet) console.log(`\n【${author}】库内 ${mine.length} 部`);
  const { rows, error, pages } = await searchAuthor(author);
  if (error) {
    if (!quiet) console.log(`  ⚠ 检索失败：${error}（已取 ${pages} 页）`);
    if (opacHealth.failures >= FAILURE_LIMIT) {
      aborted = `连续 ${opacHealth.failures} 位作者的检索都失败，已中止以免继续加压`;
      break;
    }
    continue;
  }
  if (!rows.length) {
    if (!quiet) console.log('  ⚠ 馆藏无结果（**不等于该作者没有别的书**，只是本馆未入藏）');
    continue;
  }
  if (!quiet) console.log(`  馆藏 ${rows.length} 条（${pages} 页）`);

  const fresh = [];
  const maybe = [];
  for (const r of rows) {
    const n = normTitle(r.name);
    if (!n) continue;
    if (known.has(n)) continue;
    // 一方包含另一方 → 疑同书（译名差异），交人判断
    const hit = knownList.find((k) => k && (k.includes(n) || n.includes(k)) && Math.min(k.length, n.length) >= 4);
    if (hit) maybe.push({ ...r, hit });
    else fresh.push(r);
  }

  if (maybe.length) {
    if (!quiet) {
      console.log(`  ── 疑同书（题名一方包含另一方，**多半是同一部的另一种译名**，勿直接新增）──`);
      for (const r of maybe) console.log(`     ${r.name}  ${r.year || '?'}  ${r.pub || ''}  marc ${r.marc}`);
    }
    for (const r of maybe) {
      collected.push({ author, kind: 'maybe', ...r, hit: r.hit });
    }
  }

  if (!fresh.length) {
    if (!quiet) console.log('  ✓ 没有馆藏中未收的题名');
    continue;
  }

  totalNew += fresh.length;
  totalMaybe += maybe.length;
  if (!quiet) {
    console.log(`  ── 馆藏有、库内无（${fresh.length} 条，**须逐条核题材与责任者**）──`);
    for (const r of fresh) {
      const t = String(r.name || '').trim();
      console.log(`     ${t}  ${r.year || '?'}  ${r.pub || ''}  ${r.callno || ''}  marc ${r.marc}`);
    }
  }
  for (const r of fresh) collected.push({ author, kind: 'new', ...r });

  if (wantDetail) {
    for (const r of fresh) {
      try {
        const d = await detail(r.marc);
        console.log(`     ▸ ${r.name}: ${d.titleRaw || '(无题名责任者)'}`);
        console.log(`       ${d.publine || ''} | ${d.isbn || ''} | ${clcVerdict(d.clc, d.subjects).join('；')}`);
      } catch (e) {
        console.log(`     ▸ ${r.name}: 详情抓取失败（${e.message}）`);
      }
      await new Promise((res) => setTimeout(res, 400));
    }
  }

  // 每处理完一位作者就落盘，中断也不丢已得的部分
  flush();
  if (quiet && collected.length && collected.length % 50 < fresh.length) {
    console.log(`  … 已扫 ${authors.indexOf(author) + 1}/${authors.length} 位作者，累计候选 ${collected.length} 条`);
  }
}

console.log(
  `\n  合计：馆藏中未收题名 ${totalNew} 条，疑同书 ${totalMaybe} 条。` +
    `\n  提醒：这里的「未收」只是**本馆有、库里没有**，不等于一定是新书——` +
    `\n        可能是译名不同（见「疑同书」）、可能是非推理、也可能是同名他人的书。` +
    `\n        每条都要照 \`docs/collection-backlog.md\` 第十节的规程核过题材与责任者才能收。\n`
);

if (aborted) {
  console.log(`\n  ✗ 已熔断中止：${aborted}`);
  console.log(`    已扫描的部分结果${outFile ? `已写入 ${outFile}` : '未落盘（未给 --out）'}。`);
  console.log('    请**隔一段时间再试**，并把 --all 拆成几批跑，别一次打上千次请求。\n');
}

if (outFile) {
  flush(aborted ? `# ⚠ 本次运行被熔断中止：${aborted}\n` : '');
  console.log(`  ✓ 已写出 ${outFile}（${collected.length} 条${aborted ? '，为中止前的部分结果' : ''}）\n`);
}
