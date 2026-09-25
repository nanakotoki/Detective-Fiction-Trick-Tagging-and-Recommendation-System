#!/usr/bin/env node
/**
 * 从知识库重建评分图谱
 * ====================
 * `data/ratings-atlas.json` 是**抓取溯源层**：记录每次实时抓取的
 * 分数、评价人数、来源链接与抓取时间。`apply-ratings.mjs` 会把其中的
 * 实时数据写回 `data/books/*.json`，写回时**保留了 sourceUrl / fetchedAt /
 * subjectId / edition**，所以书籍文件本身就是一份完整的溯源副本。
 *
 * 因此当图谱被误覆盖或丢失时，可以从书籍文件如实重建——不需要重新抓取，
 * 也不会伪造任何来源：重建出来的每条记录都带着原本的 subjectId 与抓取时间，
 * 只是 `recordCount` 会少掉那些「抓过但已从库中删除」的条目（合并重复条目时删掉的）。
 *
 * 什么时候会用到：`refresh-ratings.mjs` 若以非 `--merge` 方式**定向**抓取
 * （`--book` / `--limit`），会写出一份只含少数条目的图谱覆盖原文件，
 * 把其余记录清空。现在那种用法已被脚本本身拦下并自动转为合并模式，
 * 本脚本用于修复历史上已经被覆盖的情况。
 *
 * 用法：
 *   node scripts/rebuild-atlas.mjs            预演，打印将要写入的内容摘要
 *   node scripts/rebuild-atlas.mjs --apply    实际写入
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');
const ATLAS = path.join(ROOT, 'data', 'ratings-atlas.json');

const APPLY = process.argv.includes('--apply');

const files = fs
  .readdirSync(BOOKS_DIR)
  .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  .sort();

const records = [];
const misses = [];
let total = 0;

for (const f of files) {
  const list = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, f), 'utf8'));
  if (!Array.isArray(list)) continue;
  for (const b of list) {
    total += 1;
    const d = (b.ratings || {}).douban || {};
    if (d.score == null || !d.sourceUrl) {
      misses.push({
        id: b.id,
        title: b.title,
        reason: d.score != null
          ? '有评分但缺少来源链接，未纳入图谱（需重新抓取补来源）'
          : '知识库中标记为「暂无数据」，需重新抓取',
      });
      continue;
    }
    records.push({
      id: b.id,
      title: b.title,
      author: b.author,
      platform: 'douban',
      score: d.score,
      count: d.count ?? null,
      scale: d.scale ?? '10 分制',
      sourceUrl: d.sourceUrl,
      subjectId: d.subjectId ?? null,
      editionTitle: d.edition ?? null,
      editionYear: null,
      fetchedAt: d.fetchedAt ?? null,
      asOf: d.asOf ?? null,
      previousOfflineScore: null,
      delta: null,
      lowSample: (d.count ?? 0) < 200,
      comparedEditions: null,
      searchQuery: null,
      rebuiltFrom: `data/books/${f}`,
    });
  }
}

records.sort((a, b) => String(a.id).localeCompare(String(b.id)));

const payload = {
  format: 'dftr-ratings-atlas',
  version: 1,
  platform: 'douban',
  scale: '10 分制',
  generatedAt: new Date().toISOString(),
  elapsedSeconds: 0,
  requestCount: 0,
  note:
    '本文件为**实时抓取**的豆瓣公开评分与评价人数，每条记录都带 sourceUrl 与 fetchedAt，可逐条追溯。' +
    '仅读取评分与评价人数，未抓取任何书评正文，避免引入剧透。' +
    '本次内容由 scripts/rebuild-atlas.mjs 从 data/books/*.json 中已写入的溯源字段重建（原图谱被一次定向抓取覆盖），' +
    '并非重新抓取；所有 sourceUrl / fetchedAt / subjectId 均沿用原始抓取值，未做任何编造。',
  recordCount: records.length,
  missCount: misses.length,
  records,
  misses,
};

console.log('');
console.log('  评分图谱重建');
console.log('  ────────────────────────────────────────────');
console.log(`  扫描 ${files.length} 个文件 / ${total} 部作品`);
console.log(`  可重建记录 ${records.length} 条，未命中 ${misses.length} 条`);

const existing = fs.existsSync(ATLAS)
  ? (() => {
      try {
        return JSON.parse(fs.readFileSync(ATLAS, 'utf8'));
      } catch {
        return null;
      }
    })()
  : null;
console.log(`  现有图谱   ${existing ? `${existing.records?.length ?? 0} 条记录` : '（不存在）'}`);

const withUrl = records.filter((r) => r.sourceUrl).length;
const withTime = records.filter((r) => r.fetchedAt).length;
console.log(`  溯源完整   来源链接 ${withUrl} 条，抓取时间 ${withTime} 条`);
const stale = records.filter((r) => !r.fetchedAt).length;
if (stale) console.log(`  ! ${stale} 条缺少抓取时间，请重新抓取补齐`);
console.log('');

if (!APPLY) {
  console.log('  预演模式（未写入）。加 --apply 执行。');
  console.log('');
  process.exit(0);
}

fs.writeFileSync(ATLAS, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`  ✓ 已写出 ${ATLAS}`);
console.log('    下一步：node scripts/verify-ratings.mjs 复核来源可追溯性与量纲');
console.log('');
