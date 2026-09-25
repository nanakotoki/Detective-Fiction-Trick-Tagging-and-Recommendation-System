#!/usr/bin/env node
/**
 * 版本年提取普查（`editionYear`）
 * ================================
 * 背景：2026-09 按用户裁决把年份拆成两个字段（见 docs/collection-backlog.md 第十一节）：
 *   · `firstPublished` ＝ 作品首次出版年（原作年）
 *   · `editionYear`    ＝ **本库所引版本的出版年**
 * 拆完之后，只有 `batch-93` 起新增的 129 条译作填了 `editionYear`。
 * 而**老条目的 `verification.source` 里其实早就写着出版社与版本年**
 * （例如「书目取自豆瓣条目 subject/…（新星出版社 2011-4，417 页，ISBN …）」），
 * 只是从没被抽成字段。本脚本把这批信息捞出来。
 *
 * ⚠️ 判据从紧，**只写报告不改库**：
 *   · 只在 `editionYear` 为空时提取；
 *   · 一条来源里若出现**多个「出版社＋年份」对**（该书有多个版本），一律标 `multi` 交人工判断，
 *     不自动取第一个——「把再版年当首版年」正是本项目反复踩过的坑；
 *   · 提取到的年份若**与 `firstPublished` 相同**，标 `same` 并建议留空
 *     （中文原创作品两者本来就相同，`check-data` 也会就此告警）。
 *
 * 用法：node scripts/scan-edition-year.mjs [--apply]
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = 'data/books';
const OUT = 'data/_edition-year.tsv';
const APPLY = process.argv.includes('--apply');

/** 出版社名 + 年份：允许中间夹「，2011-4」「 2024.12」「2009年10月」等写法 */
const PAIR_RE =
  /([\u4e00-\u9fa5A-Za-z（）()·．\.]{2,24}?(?:出版社|出版公司|出版集团|出版有限责任公司|书局|书店|文库))[^0-9\u4e00-\u9fff]{0,4}(\d{4})(?:[-.\/年]\d{1,2})?/g;

const rows = [];
let total = 0;
let already = 0;

for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  const p = `${DIR}/${f}`;
  const books = JSON.parse(readFileSync(p, 'utf8'));
  let dirty = false;
  for (const b of books) {
    total += 1;
    if (String(b.editionYear || '').trim()) {
      already += 1;
      continue;
    }
    const src = String(b.verification?.source ?? '');
    if (!src) continue;

    const pairs = [...src.matchAll(PAIR_RE)].map((m) => ({ publisher: m[1].replace(/^[（(]/, ''), year: m[2], text: m[0] }));
    // 去重（同一对可能重复出现）
    const uniq = [];
    for (const x of pairs) if (!uniq.some((y) => y.year === x.year && y.publisher === x.publisher)) uniq.push(x);
    if (!uniq.length) continue;

    const years = [...new Set(uniq.map((x) => x.year))];
    const first = String(b.firstPublished || '').match(/\d{4}/)?.[0] ?? '';

    let status;
    if (uniq.length > 1) status = 'multi';
    else if (first && years[0] === first) status = 'same';
    else status = 'ok';

    rows.push({ status, ...b, extracted: years.join(','), detail: uniq.map((x) => `${x.year}(${x.publisher})`).join(' ') });

    if (APPLY && status === 'ok') {
      b.editionYear = years[0];
      if (b.verification && typeof b.verification.source === 'string' && !b.verification.source.includes('版本年提取')) {
        b.verification.source +=
          ` **版本年提取（2026-09）**：本条原先未填 \`editionYear\`。该字段（本库所引版本的出版年）` +
          `在此前的溯源文本里已有记载——「${uniq[0].text}」——故抽成字段，未引入新信息、未改动 \`firstPublished\`（作品原作年）。`;
      }
      dirty = true;
    }
  }
  if (dirty) writeFileSync(p, `${JSON.stringify(books, null, 2)}\n`);
}

const header =
  '# editionYear 提取普查（生成：node scripts/scan-edition-year.mjs）\n' +
  '# status: ok=可采信的唯一年份 / multi=来源里有多个版本，需人工判断 / same=与 firstPublished 相同，建议留空\n' +
  '# 列：status \\t 条目id \\t 书名 \\t 作者 \\t firstPublished \\t 提取到的年 \\t 来源里的原文 \\t 文件\n';
writeFileSync(
  OUT,
  `${header}${rows
    .map((r) => [r.status, r.id, r.title, r.author, r.firstPublished || '', r.extracted, r.detail, r.file ?? ''].join('\t'))
    .join('\n')}\n`,
  'utf8'
);

const by = (s) => rows.filter((r) => r.status === s).length;
console.log('\n  editionYear 提取普查');
console.log('  ────────────────────────────────────────────');
console.log(`  全库 ${total} 部；已有 editionYear 的 ${already} 部`);
console.log(`  可从溯源文本提取的 ${rows.length} 部：`);
console.log(`    可采信(ok) ${by('ok')} 部 ｜ 多版本待判(multi) ${by('multi')} 部 ｜ 与原作年相同(same) ${by('same')} 部`);
console.log(`\n  示例（ok 前 8 条）：`);
for (const r of rows.filter((x) => x.status === 'ok').slice(0, 8)) {
  console.log(`    《${r.title}》 原作年 ${r.firstPublished || '空'} → 版本年 ${r.extracted}　${r.detail}`);
}
console.log(`\n  ✓ 报告已写出 ${OUT}`);
console.log(APPLY ? '  ✓ 已把 ok 的条目写回知识库\n' : '  （未加 --apply，本次不改知识库）\n');
