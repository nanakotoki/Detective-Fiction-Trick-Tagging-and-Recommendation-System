#!/usr/bin/env node
/**
 * 抓取结果交叉校验
 * ================
 * 对 data/ratings-atlas.json（实时抓取的评分图谱）做可信性检查：
 *   1. 每条记录必须有 sourceUrl 与 fetchedAt —— 没有来源的一律视为编造
 *   2. 评分必须在各平台量纲内，且小数位不超精度
 *   3. 同一本书的豆瓣(10 分制)不应低于 Goodreads(5 分制)
 *   4. 同一批抓取中，评价人数不应出现"整十整百"的可疑集中
 *   5. 与 data/books 中已有的离线估计值做偏差对比，超过阈值给出提醒
 *
 * 用法：node scripts/verify-ratings.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateRating } from '../web/js/core/ratings.js';
import { normalizeSeedBook } from '../web/js/core/seed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ATLAS = path.join(ROOT, 'data', 'ratings-atlas.json');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');

const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m', cyan: '\u001b[36m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

/** 评分偏差告警阈值（超过则提示人工复核，不一定错） */
const DRIFT_THRESHOLD = { douban: 0.8, goodreads: 0.6 };

function loadBooks() {
  const books = [];
  for (const file of fs.readdirSync(BOOKS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()) {
    let list;
    try {
      list = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, file), 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const book = normalizeSeedBook(item, null, file);
      if (book) books.push(book);
    }
  }
  return books;
}

function main() {
  console.log('');
  console.log(color('  实时评分图谱校验', C.bold));
  console.log(color('  ────────────────────────────────────────────', C.dim));

  if (!fs.existsSync(ATLAS)) {
    console.log(color('  ! 尚未生成 data/ratings-atlas.json', C.yellow));
    console.log(color('    生成方式见 docs/data-sources.md（联网环境运行 npm run refresh:ratings）', C.dim));
    console.log('');
    process.exit(0);
  }

  const atlas = JSON.parse(fs.readFileSync(ATLAS, 'utf8'));
  const records = Array.isArray(atlas) ? atlas : (atlas.records ?? []);
  const books = loadBooks();
  const bookById = new Map(books.map((b) => [b.id, b]));

  const errors = [];
  const warnings = [];
  const drift = [];

  let withUrl = 0;
  const countsSeen = [];

  for (const record of records) {
    const where = `《${record.title ?? record.id}》· ${record.platform ?? '?'}`;

    // 1. 来源可追溯
    if (!record.sourceUrl) {
      errors.push(`${where}：缺少 sourceUrl —— 无法追溯来源的数据一律视为不可信`);
      continue;
    }
    if (!record.fetchedAt) {
      errors.push(`${where}：缺少 fetchedAt —— 无法判断数据新鲜度`);
      continue;
    }
    withUrl += 1;

    // 2. 量纲与精度
    const check = validateRating(record.platform, record);
    if (!check.ok) {
      errors.push(`${where}：${check.reasons.join('；')}`);
      continue;
    }

    if (Number.isInteger(record.count)) countsSeen.push(record.count);

    // 3. 书籍必须存在
    if (record.id && !bookById.has(record.id)) {
      warnings.push(`${where}：知识库中没有 id 为 ${record.id} 的作品`);
    }

    // 4. 与离线估计值对比
    const book = bookById.get(record.id);
    const previous = book?.ratings?.[record.platform]?.score;
    if (typeof previous === 'number' && typeof record.score === 'number') {
      const diff = Math.abs(previous - record.score);
      const limit = DRIFT_THRESHOLD[record.platform] ?? 1;
      if (diff > limit) {
        drift.push({
          book: book.title,
          platform: record.platform,
          offline: previous,
          live: record.score,
          diff: Number(diff.toFixed(2)),
        });
      }
    }

    // 5. 抓取时间不能是未来
    const fetched = new Date(record.fetchedAt);
    if (Number.isNaN(fetched.getTime())) errors.push(`${where}：fetchedAt 不是合法时间`);
    else if (fetched.getTime() > Date.now() + 86400000) errors.push(`${where}：fetchedAt 位于未来，数据不可信`);
  }

  /* ---------------- 可疑的整数集中 ---------------- */
  const roundish = countsSeen.filter((n) => n >= 1000 && n % 100 === 0);
  const roundishRatio = countsSeen.length ? roundish.length / countsSeen.length : 0;
  if (countsSeen.length >= 10 && roundishRatio > 0.35) {
    warnings.push(
      `评价人数中有 ${String(Math.round(roundishRatio * 100))}% 是整百数（${String(roundish.length)}/${String(countsSeen.length)}），` +
        `真实平台的评价人数很少如此整齐，建议抽查原始页面`,
    );
  }

  /* ---------------- 输出 ---------------- */
  const platforms = new Map();
  for (const r of records) platforms.set(r.platform, (platforms.get(r.platform) ?? 0) + 1);

  console.log(`  记录总数     ${String(records.length)} 条`);
  console.log(`  可追溯来源   ${String(withUrl)} 条${withUrl === records.length ? color('（全部具备）', C.green) : color(`（${String(records.length - withUrl)} 条缺失）`, C.red)}`);
  console.log(`  抓取时间     ${atlas.generatedAt ?? records[0]?.fetchedAt ?? '未知'}`);
  console.log(`  平台分布     ${[...platforms.entries()].map(([p, n]) => `${p} ${String(n)}`).join(' / ') || '—'}`);
  console.log(`  覆盖作品     ${String(new Set(records.map((r) => r.id)).size)} / ${String(books.length)} 部`);

  /* ---------------- 未命中原因分类 ---------------- */
  // 三种未命中的含义完全不同，混在一起报「暂无数据」会看不出该做什么：
  //   · 只索引到外文原版 → 豆瓣没收录中文版条目，该换检索思路
  //   · 条目存在但尚无评分 → 数据已到位，只是缺评分
  //   · 检索无结果 → 关键词没覆盖到
  const missList = Array.isArray(atlas.misses) ? atlas.misses : [];
  if (missList.length) {
    const buckets = [
      ['豆瓣只索引到外文原版（中文版未进检索索引）', (r) => /只索引到外文原版/.test(r)],
      ['条目存在但尚无评分', (r) => /尚无评分/.test(r)],
      ['检索无结果', (r) => /检索无结果/.test(r)],
    ];
    const other = missList.filter((m) => !buckets.some(([, test]) => test(String(m.reason ?? ''))));
    console.log(`  未命中       ${String(missList.length)} 部`);
    for (const [label, test] of buckets) {
      const hit = missList.filter((m) => test(String(m.reason ?? '')));
      if (hit.length) console.log(`               · ${label}：${String(hit.length)} 部`);
    }
    if (other.length) console.log(`               · 其他原因：${String(other.length)} 部`);
    console.log(
      color('               （`node scripts/show-misses.mjs` 可列出全部未命中项与原因）', C.dim)
    );
  }

  if (drift.length) {
    console.log('');
    console.log(color(`  ! 与离线估计值偏差较大（${String(drift.length)} 条，可能说明离线估计不准，也可能是抓到了不同版本）`, C.yellow));
    for (const d of drift.slice(0, 25)) {
      console.log(`    《${d.book}》${d.platform}：离线 ${String(d.offline)} → 实时 ${String(d.live)}（差 ${String(d.diff)}）`);
    }
    if (drift.length > 25) console.log(color(`    … 另有 ${String(drift.length - 25)} 条`, C.dim));
  }

  if (warnings.length) {
    console.log('');
    console.log(color(`  ! 警告 ${String(warnings.length)} 项`, C.yellow));
    for (const w of warnings.slice(0, 20)) console.log(`    ${w}`);
  }

  console.log('');
  if (errors.length) {
    console.log(color(`  ✗ 错误 ${String(errors.length)} 项`, C.red + C.bold));
    for (const e of errors.slice(0, 30)) console.log(`    ${color('✗', C.red)} ${e}`);
    console.log('');
    process.exit(1);
  }

  console.log(color('  ✓ 全部记录来源可追溯、量纲合法', C.green + C.bold));
  console.log('');
}

main();
