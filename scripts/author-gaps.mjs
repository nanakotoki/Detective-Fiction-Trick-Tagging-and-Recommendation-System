#!/usr/bin/env node
/**
 * 作者缺口核对（维护工具）
 * ========================
 * 收录口径已明确为**按作者收全**，而不是铺国家。
 * 这个工具回答一个问题：某位作者的作品，知识库里已经有哪几本、还能补哪几本。
 *
 * 用法：
 *   node scripts/author-gaps.mjs 阿加莎·克里斯蒂 --file candidates/christie.txt
 *   node scripts/author-gaps.mjs 东野圭吾 放学后 白夜行 解忧杂货店
 *   node scripts/author-gaps.mjs 岛田庄司 --list          只列出库里已有作品
 *
 * 候选名单每行一个书名（# 开头为注释）。工具会：
 *   1. 先比对知识库 —— 已在库里的直接标「已有」，不浪费请求
 *   2. 其余逐个探测豆瓣 suggest —— 有中文条目才算「可补」
 *   3. 对可补的条目抓详情页取评分与评价人数，方便判断优先补哪本
 *
 * 设计原则与 refresh-ratings 一致：只读评分与评价人数，不抓书评正文，1.1 秒/次。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDoubanSuggest, parseDoubanSubject } from '../web/js/core/ratings.js';
import { normalizeTitle } from './refresh-ratings.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const argv = process.argv.slice(2);
const listOnly = argv.includes('--list');
const noRating = argv.includes('--no-rating');
const fileIndex = argv.indexOf('--file');
const positional = argv.filter((a) => !a.startsWith('--'));
const author = positional[0];

if (!author) {
  console.log('');
  console.log('  用法：node scripts/author-gaps.mjs <作者名> [候选书名…] [--file 名单.txt] [--list]');
  console.log('');
  process.exit(1);
}

/**
 * 书名归一交给 `refresh-ratings.mjs`，不要在这里另写一套。
 *
 * 之前这里自己实现过一版，只去掉书名号与标点，结果：
 *   「连续杀人鬼青蛙男」 vs 豆瓣「连续“杀人鬼”青蛙男」被判成两本书；
 *   「晚安拉赫曼尼诺夫」 vs 台版「晚安，拉赫曼尼諾夫」同样对不上。
 * 复用同一套规则后，引号、繁体、连接字都会被一并归一。
 */

function loadBooks() {
  const books = [];
  for (const file of fs.readdirSync(BOOKS_DIR).filter((f) => f.endsWith('.json'))) {
    let list;
    try {
      list = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, file), 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(list)) continue;
    for (const b of list) books.push(b);
  }
  return books;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, asJson = false) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, referer: 'https://book.douban.com/' },
    });
    if (!res.ok) return null;
    return asJson ? res.json() : res.text();
  } catch {
    return null;
  }
}

const all = loadBooks();
const mine = all.filter((b) => String(b.author ?? '').includes(author));

console.log('');
console.log(`  《${author}》在库作品：${mine.length} 部`);
for (const b of mine.sort((a, b) => String(a.firstPublished).localeCompare(String(b.firstPublished)))) {
  const d = b.ratings?.douban;
  const r = d?.score != null ? `${d.score}（${d.count ?? '?'}）` : '暂无评分';
  console.log(`    · ${b.title}  [${b.firstPublished || '年份未标注'}]  ${r}`);
}

if (listOnly) {
  console.log('');
  process.exit(0);
}

let candidates = positional.slice(1);
if (fileIndex !== -1) {
  const raw = fs.readFileSync(argv[fileIndex + 1], 'utf8');
  candidates = candidates.concat(
    raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')),
  );
}

if (!candidates.length) {
  console.log('');
  console.log('  未提供候选书名。加 --file 名单.txt 或直接跟书名。');
  console.log('');
  process.exit(0);
}

const owned = new Set(mine.map((b) => normalizeTitle(b.title)));
// 全库书名也要比：同一本可能登记在另一位作者名下（合著、选集）
const ownedAnywhere = new Set(all.map((b) => normalizeTitle(b.title)));

const fillable = [];
const missing = [];

for (const title of candidates) {
  const key = normalizeTitle(title);
  if (owned.has(key)) {
    console.log(`  ${title.padEnd(26, ' ')} 已有`);
    continue;
  }
  if (ownedAnywhere.has(key)) {
    console.log(`  ${title.padEnd(26, ' ')} 已有（登记在其他条目下）`);
    continue;
  }

  const raw = await get(`https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(title)}`, true);
  const hits = raw ? parseDoubanSuggest(raw) : [];
  /**
   * 必须**书名与作者都对得上**才算命中。
   *
   * 只核作者会出错：搜「妖怪博士」时，第一个作者名匹配的条目是
   * 选集《乱步侦探作品集.2》——它确实收录了这篇，但拿它的评分当这本书的评分
   * 就是串台。所以要求库里的书名与豆瓣条目标题互为包含关系（归一化后）。
   */
  const q = normalizeTitle(title);
  const matched =
    hits.find((h) => {
      if (!String(h.author ?? '').includes(author)) return false;
      const t = normalizeTitle(h.title);
      return t.includes(q) || q.includes(t);
    }) ?? null;
  const authorOnly = matched
    ? []
    : hits.filter((h) => String(h.author ?? '').includes(author)).map((h) => h.title);

  if (!matched) {
    if (authorOnly.length) {
      // 作者对得上但书名对不上：多半是选集或译名差异，单独报出来人工判断
      console.log(`  ${title.padEnd(26, ' ')} ? 书名对不上  （豆瓣有该作者的：${authorOnly.slice(0, 2).join(' / ')}）`);
    } else {
      console.log(`  ${title.padEnd(26, ' ')} ✗ 无中文条目`);
    }
    missing.push(title);
  } else {
    let ratingText = '（未取评分）';
    if (!noRating) {
      await sleep(1100);
      const html = await get(matched.url);
      const r = html ? parseDoubanSubject(html, { subjectId: matched.id, sourceUrl: matched.url }) : null;
      ratingText = r?.score != null ? `${r.score} 分 / ${r.count ?? '?'} 人` : '条目暂无评分';
    }
    console.log(`  ${title.padEnd(26, ' ')} ✔ 可补  ${matched.title}（${matched.year ?? '?'}）  ${ratingText}`);
    fillable.push({ title, doubanTitle: matched.title, year: matched.year, url: matched.url });
  }
  await sleep(1100);
}

console.log('');
console.log(`  小结：可补 ${fillable.length} 部 · 无中文条目 ${missing.length} 部 · 候选共 ${candidates.length} 个`);
if (missing.length) console.log(`  无中文条目：${missing.join('、')}`);
console.log('');
