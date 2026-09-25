#!/usr/bin/env node
/**
 * 豆瓣条目批量探测（维护工具）
 * ============================
 * 扩充知识库前，先确认这些书在豆瓣**确实有中文条目**——
 * 没有条目就没有可追溯的评分与评价人数，写进数据文件只会变成编造。
 *
 * 用法：
 *   node scripts/probe-titles.mjs 方舟 镜之孤城 无惨
 *   node scripts/probe-titles.mjs --file candidates.txt     每行一个书名
 *   node scripts/probe-titles.mjs --json 方舟              机器可读输出
 *
 * 说明：
 *   · 只调用豆瓣的 subject_suggest 检索接口，**不抓详情页**，因此不会引入剧透
 *   · 默认 1.1 秒/次，与 refresh-ratings.mjs 保持一致，避免给对方造成压力
 *   · 作者名检索不可用：该接口对作者名只返回一个作者节点，不会列出作品，
 *     所以要用**具体书名**探测，不要传作者名
 */

import { parseDoubanSuggest } from '../web/js/core/ratings.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const fileIndex = argv.indexOf('--file');
const quiet = argv.includes('--quiet');

let titles = argv.filter((a) => !a.startsWith('--'));
if (fileIndex !== -1) {
  const fs = await import('node:fs');
  const path = argv[fileIndex + 1];
  titles = fs
    .readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

if (!titles.length) {
  console.log('');
  console.log('  用法：node scripts/probe-titles.mjs <书名> [书名…]');
  console.log('        node scripts/probe-titles.mjs --file candidates.txt');
  console.log('');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function suggest(query) {
  const url = `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://book.douban.com/' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseDoubanSuggest(await res.text());
}

const results = [];

for (const title of titles) {
  let hits = [];
  let error = null;
  try {
    hits = (await suggest(title))
      // 过滤掉以「[」开头的条目（多为期刊 / 合辑占位），保留真正的图书
      .filter((i) => i.title && !/^\[/.test(String(i.title)))
      .slice(0, 3)
      .map((i) => ({ title: i.title, year: i.year ?? null, author: i.author ?? '' }));
  } catch (e) {
    error = e.message;
  }

  results.push({ query: title, hits, error });

  if (!asJson) {
    const body = error
      ? `[失败] ${error}`
      : hits.length
        ? hits.map((h) => `${h.title}（${h.year ?? '?'}）${h.author}`).join('  |  ')
        : '（无命中）';
    console.log(`${title.padEnd(24, ' ')} -> ${body}`);
  }

  await sleep(1100);
}

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else if (!quiet) {
  const hit = results.filter((r) => r.hits.length).length;
  console.log('');
  console.log(`  命中 ${hit} / ${results.length} 个检索词`);
  const miss = results.filter((r) => !r.hits.length && !r.error).map((r) => r.query);
  if (miss.length) console.log(`  未命中：${miss.join('、')}`);
  console.log('');
}
