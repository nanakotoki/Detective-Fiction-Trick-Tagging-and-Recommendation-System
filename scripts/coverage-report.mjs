#!/usr/bin/env node
/**
 * 知识库覆盖度报告
 * ================
 * 统计作者 / 国别 / 流派 / 年代 / 标签的分布，并给出"下一步该补什么"的建议。
 * 用途：扩充知识库时避免只堆同一个作者，也避免遗漏整块空白门类。
 *
 * 运行：node scripts/coverage-report.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeSeedBook } from '../web/js/core/seed.js';
import { TAGS, TAG_MAP, tagLabel } from '../web/js/core/tags.js';
import { bookTagIds } from '../web/js/core/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');

const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', green: '\u001b[32m', yellow: '\u001b[33m', cyan: '\u001b[36m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

/** 每个作者最多收录多少本算"偏多"（推荐算法本身限制同作者最多推荐 2 本） */
const AUTHOR_SOFT_CAP = 5;

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

/** 计数并按数量降序排列 */
function tally(items) {
  const map = new Map();
  for (const item of items) {
    if (!item) continue;
    map.set(item, (map.get(item) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function bar(count, max, width = 22) {
  const filled = max > 0 ? Math.round((count / max) * width) : 0;
  return '█'.repeat(filled) + '·'.repeat(Math.max(0, width - filled));
}

function printTally(title, entries, { limit = 20, note = '' } = {}) {
  console.log('');
  console.log(color(`  ${title}`, C.bold) + (note ? color(`  ${note}`, C.dim) : ''));
  if (!entries.length) {
    console.log(color('    （无数据）', C.dim));
    return;
  }
  const max = entries[0]?.[1] ?? 1;
  // 名称可能很长（如「多萝西·L·塞耶斯」），先按显示宽度算出统一的列宽，
  // 否则柱状图会因 padEnd 不足而错位（全角字符占两列）。
  const width = Math.min(20, Math.max(...entries.slice(0, limit).map(([name]) => displayWidth(String(name)))));
  for (const [name, count] of entries.slice(0, limit)) {
    const label = String(name);
    const pad = ' '.repeat(Math.max(0, width - displayWidth(label)));
    console.log(`    ${label}${pad}  ${String(count).padStart(4)}  ${color(bar(count, max), C.cyan)}`);
  }
  if (entries.length > limit) {
    console.log(color(`    … 另有 ${entries.length - limit} 项`, C.dim));
  }
}

/** 显示宽度：全角字符按 2 列计算 */
function displayWidth(text) {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    w += code >= 0x1100 && (code <= 0x115f || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6)) ? 2 : 1;
  }
  return w;
}

function main() {
  const books = loadBooks();
  console.log('');
  console.log(color(`  知识库覆盖度报告`, C.bold) + color(`   共 ${books.length} 部作品 / ${new Set(books.map((b) => b.author)).size} 位作者`, C.dim));

  /* ---------------- 作者 ---------------- */
  const byAuthor = tally(books.map((b) => b.author));
  printTally('作者分布', byAuthor, { limit: 18 });

  const crowded = byAuthor.filter(([, n]) => n > AUTHOR_SOFT_CAP);
  if (crowded.length) {
    console.log('');
    console.log(
      color(
        `  ! ${crowded.length} 位作者的收录数超过 ${AUTHOR_SOFT_CAP} 本：` +
          crowded.map(([a, n]) => `${a}(${n})`).join('、'),
        C.yellow,
      ),
    );
    console.log(color('    推荐算法限制同作者最多推荐 2 本，继续加同一作者的书边际收益递减', C.dim));
  }

  /* ---------------- 国别 ---------------- */
  printTally('国别 / 地区分布', tally(books.map((b) => b.country || '未标注')), { limit: 15 });

  /* ---------------- 流派 ---------------- */
  printTally('流派分布', tally(books.map((b) => b.genre)), { limit: 12 });

  /* ---------------- 流派（school，正交维度） ---------------- */
  // genre 是"这本书属于哪一类"的单值字段；school 是可多选的写法取向维度，
  // 两者的分布必须分开看，否则会误以为某个流派没人写。
  printTally('推理流派分布（school，可多选）', tally(books.flatMap((b) => b.schoolTags ?? [])), { limit: 14 });
  const multiSchool = books.filter((b) => (b.schoolTags ?? []).length > 1).length;
  const noSchool = books.filter((b) => (b.schoolTags ?? []).length === 0).length;
  console.log(`    多流派标注 ${multiSchool} 部，未标注 ${noSchool} 部`);

  /* ---------------- 年代 ---------------- */
  const decades = books.map((b) => {
    const y = Number(String(b.firstPublished).match(/\d{4}/)?.[0] ?? 0);
    if (!y) return '未标注';
    return `${String(Math.floor(y / 10) * 10)}s`;
  });
  printTally('出版年代分布', tally(decades).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), { limit: 20 });

  /* ---------------- 标签使用 ---------------- */
  const tagCounts = new Map();
  for (const book of books) for (const id of bookTagIds(book)) tagCounts.set(id, (tagCounts.get(id) ?? 0) + 1);

  const unused = TAGS.filter((t) => !tagCounts.has(t.id));
  const rare = TAGS.filter((t) => (tagCounts.get(t.id) ?? 0) > 0 && (tagCounts.get(t.id) ?? 0) <= 2);

  console.log('');
  console.log(color('  标签覆盖', C.bold));
  console.log(`    字典标签 ${TAGS.length} 个，实际使用 ${tagCounts.size} 个`);
  if (unused.length) {
    console.log(color(`    ! 未被任何作品使用（${unused.length}）：${unused.map((t) => t.label).join('、')}`, C.yellow));
  }
  if (rare.length) {
    console.log(color(`    i 仅 1~2 部作品使用（${rare.length}）：${rare.map((t) => t.label).join('、')}`, C.dim));
  }

  /* ---------------- 数据完整度 ---------------- */
  const withSummary = books.filter((b) => b.safeSummary).length;
  const withTips = books.filter((b) => (b.readingTips?.watchFor ?? []).length > 0).length;
  const withSeries = books.filter((b) => b.series).length;

  /** 按平台统计三种状态：实时（带 sourceUrl）/ 离线估计（有分数无来源）/ 暂无数据 */
  const platform = (key) => {
    const stat = { live: 0, estimate: 0, none: 0 };
    for (const b of books) {
      const entry = b.ratings?.[key];
      if (entry?.sourceUrl) stat.live += 1;
      else if (entry?.score != null) stat.estimate += 1;
      else stat.none += 1;
    }
    return stat;
  };

  console.log('');
  console.log(color('  数据完整度', C.bold));
  console.log(`    去剧透简介      ${withSummary} / ${books.length}`);
  console.log(`    阅读提示        ${withTips} / ${books.length}`);
  console.log(`    标注为系列作品   ${withSeries} / ${books.length}`);
  console.log('');
  console.log(color('  平台评分覆盖（🟢 实时 / 🟡 离线估计 / ⚪ 暂无数据）', C.bold));
  for (const [key, label] of [
    ['douban', '豆瓣'],
    ['goodreads', 'Goodreads'],
    ['hupu', '虎扑'],
  ]) {
    const s = platform(key);
    console.log(`    ${label.padEnd(12, ' ')} 🟢 ${String(s.live).padStart(3)} 部 / 🟡 ${String(s.estimate).padStart(3)} 部 / ⚪ ${String(s.none).padStart(3)} 部`);
  }

  // 评价人数分布：样本量直接决定分数的可信度，README 里引用的是这里的数字
  const votes = books
    .map((b) => (b.ratings?.douban?.sourceUrl ? b.ratings.douban.count : null))
    .filter((n) => typeof n === 'number' && n > 0)
    .sort((a, b) => a - b);
  if (votes.length) {
    const median = votes[Math.floor(votes.length / 2)];
    const low = votes.filter((n) => n < 200).length;
    console.log(
      `    豆瓣评价人数中位数 ${median.toLocaleString('en-US')} 人，最高 ${votes[votes.length - 1].toLocaleString('en-US')} 人；其中 ${low} 部不足 200 人（样本不足）`,
    );
  }

  /* ---------------- 建议 ---------------- */
  const suggestions = [];
  const countryCount = new Map(tally(books.map((b) => b.country || '未标注')));
  for (const gap of [
    '韩国',
    '冰岛',
    '丹麦',
    '芬兰',
    '波兰',
    '捷克',
    '巴西',
    '墨西哥',
    '阿根廷',
    '智利',
    '以色列',
    '希腊',
    '泰国',
    '印度',
    '澳大利亚',
  ]) {
    if (!countryCount.has(gap)) suggestions.push(`缺少「${gap}」的作品`);
  }
  if (unused.length) suggestions.push(`有 ${unused.length} 个标签未被使用，可补充相应类型的作品`);
  const youngAuthors = byAuthor.filter(([, n]) => n === 1).length;
  if (youngAuthors > books.length * 0.6) {
    suggestions.push(`单本作者占 ${Math.round((youngAuthors / books.length) * 100)}%，可考虑补系列代表作`);
  }

  if (suggestions.length) {
    console.log('');
    console.log(color('  扩充建议', C.bold));
    for (const s of suggestions) console.log(`    · ${s}`);
  }

  console.log('');
}

main();
