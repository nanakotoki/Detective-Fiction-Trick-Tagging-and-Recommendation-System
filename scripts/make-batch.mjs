#!/usr/bin/env node
/**
 * 批次生成器 `make-batch`
 * ======================
 * 起因：手写批次 JSON 时，`ratings`/`vault`/`origin`/`provenance` 这几块样板每部书都要重复一遍，
 * 既费篇幅又容易漏字段。改成「**只写这一部书真正独有的信息**」的紧凑 spec，
 * 由本脚本补齐样板并落盘。
 *
 * 用法：
 *   node scripts/make-batch.mjs --spec _dd/b172.spec.mjs
 * spec 模块导出：
 *   { prefix: 'shlib172', file: 'batch-172-shlib.json', source: '…', books: [ … ] }
 * 每部书字段（除 safeSummary 外均可省）：
 *   title originalTitle author authorEn genre firstPublished editionYear series detective
 *   country tags school safeSummary suitableFor watchFor warning evidence
 *
 * ⚠️ 本脚本**不生成**梗概、**不编造**评分：梗概必须由 spec 明确给出（无剧透），
 * 三个平台一律写「暂无数据」（豆瓣自 2026-09 起 403）。
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const argv = process.argv.slice(2);
const i = argv.indexOf('--spec');
if (i === -1) {
  console.log('\n  用法：node scripts/make-batch.mjs --spec _dd/b172.spec.mjs\n');
  process.exit(1);
}
const specPath = path.resolve(argv[i + 1]);
const spec = (await import(pathToFileURL(specPath).href)).default;
if (!spec?.books?.length) throw new Error('spec.books 为空');

const NO_DATA = (source) => ({ score: null, count: null, source, asOf: null, summary: '暂无数据' });

const out = spec.books.map((b, n) => {
  const id = `${spec.prefix}-${String(n + 1).padStart(3, '0')}`;
  for (const k of ['title', 'author', 'authorEn', 'genre', 'country', 'safeSummary', 'evidence']) {
    if (!b[k]) throw new Error(`${id} 缺字段 ${k}（题名 ${b.title || '?'}）`);
  }
  if (!Array.isArray(b.tags) || !b.tags.length) throw new Error(`${id} 缺 tags`);
  return {
    id,
    title: b.title,
    originalTitle: b.originalTitle || '',
    author: b.author,
    // 合集/多作者条目要带 authors 数组（库内既有写法，前端与统计脚本都优先读它）
    ...(b.authors?.length ? { authors: b.authors } : {}),
    // 同一部作品的其他中译名（同书异名核查的产物，必须落库，否则日后又会当成新书收一遍）
    ...(b.alternateTitles?.length ? { alternateTitles: b.alternateTitles } : {}),
    authorEn: b.authorEn,
    genre: b.genre,
    firstPublished: b.firstPublished || '',
    editionYear: b.editionYear || '',
    series: b.series || '',
    detective: b.detective || '',
    country: b.country,
    tags: b.tags,
    school: b.school || [],
    safeSummary: b.safeSummary,
    ratings: {
      douban: NO_DATA('豆瓣读书'),
      hupu: NO_DATA('虎扑'),
      goodreads: NO_DATA('Goodreads'),
    },
    readingTips: {
      suitableFor: b.suitableFor || [],
      watchFor: b.watchFor || [],
      warning: b.warning || '侦探推理小说，含命案描写。',
    },
    vault: { culprit: '', coreTrick: '', ending: '', notes: '' },
    origin: 'seed',
    verification: { verified: true, verifiedAt: '2026-09', source: b.evidence },
    provenance: {
      source: spec.file,
      ratingsNote: '豆瓣整站自 2026-09 起返回 403，本轮新增条目一律标注「暂无数据」，系统不编造评分。',
    },
  };
});

// 同批内查重（题名）
const seen = new Map();
for (const b of out) {
  if (seen.has(b.title)) throw new Error(`批内重题名：${b.title}`);
  seen.set(b.title, 1);
}

const dest = path.join('data', 'books', spec.file);
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`已写 ${dest}：${out.length} 部`);
for (const b of out) console.log(`  ${b.id}  ${b.title} ｜ ${b.author} ｜ ${b.editionYear || '—'}`);
