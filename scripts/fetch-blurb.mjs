#!/usr/bin/env node
/**
 * 豆瓣内容简介抓取（**仅供研究，输出不直接入库**）
 * =============================================
 * 往知识库加书时，最大的风险是**凭书名猜梗概**——之前就因此写错过
 * 《如生灵双身之物》《替身》《砂器》等多部书的书名与内容。
 * 这个脚本把豆瓣条目页上的「内容简介」抓下来，作为撰写无剧透梗概的**依据**。
 *
 * ⚠️ 两条硬规矩：
 *   1. 抓到的简介**绝不直接写进知识库**。豆瓣简介是出版社写的营销文案，
 *      经常直接把凶手、手法、结局写出来，与 `docs/reqirments.md` 的无剧透
 *      要求直接冲突。它只用来让我知道"这本书讲的是什么"，然后**自己重写**。
 *   2. 只读「内容简介」这一个区块，**不读书评、不读笔记**——书评区是剧透重灾区。
 *
 * 用法：
 *   node scripts/fetch-blurb.mjs 支仓事件 阿文的魂魄 ...
 *   node scripts/fetch-blurb.mjs --file scripts/_cand-round2.txt
 *   node scripts/fetch-blurb.mjs --quiet 支仓事件     只输出简介正文，便于粘贴阅读
 */

import { parseDoubanSuggest } from '../web/js/core/ratings.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const fi = argv.indexOf('--file');
const si = argv.indexOf('--subject');
let titles = argv.filter((a) => !a.startsWith('--'));
let subjects = [];
if (si !== -1) {
  /**
   * 按豆瓣条目 id 直取，**不做标题检索**。
   *
   * 为什么必须支持这条路径：短书名或通用书名用 `subject_suggest` 检索会匹配到
   * 完全不同的书——实际踩过：《魔都》检索到村松梢风的上海游记（不是久生十兰的），
   * 《十字街》检索到《查令十字街84号》。丛书页给出的是权威的 subject id，
   * 用它直取才不会张冠李戴。
   */
  subjects = argv
    .slice(si + 1)
    .filter((a) => /^\d+$/.test(a) || a === ',');
  titles = [];
}
if (si !== -1 && !subjects.length) {
  console.log('\n  用法：--subject <条目 id> [id...]\n');
  process.exit(1);
}
if (fi !== -1) {
  const fs = await import('node:fs');
  titles = fs
    .readFileSync(argv[fi + 1], 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}
if (!titles.length && !subjects.length) {
  console.log('\n  用法：node scripts/fetch-blurb.mjs <书名...> | --file <清单> | --subject <条目 id...> [--quiet]\n');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, json = false) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: json ? 'application/json' : 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
  });
  if (!res.ok) return null;
  return json ? res.json() : res.text();
}

/** 从详情页里取出「内容简介」段落（只取这一个区块） */
function extractIntro(html) {
  const blocks = [];
  // 豆瓣的简介在 <div class="intro">…</div>，可能有多段（折叠/展开）
  const re = /<div class="intro">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html)) !== null) blocks.push(m[1]);
  const all = blocks.join('\n');
  return all
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 统一的抓取与打印：title 只用于显示，url 是权威来源 */
async function show(label, url) {
  if (!QUIET) {
    console.log('');
    console.log('  ══════════════════════════════════════════════════════════');
    console.log(`  ${label}`);
    console.log('  ══════════════════════════════════════════════════════════');
  }
  try {
    if (!QUIET) console.log(`  条目：${url}`);
    const html = await get(url);
    if (!html) {
      console.log('  ✗ 详情页抓取失败');
      return;
    }
    const intro = extractIntro(html);
    if (!intro) console.log('  ✗ 该条目没有内容简介');
    else {
      console.log('');
      console.log(intro);
    }
  } catch (e) {
    console.log(`  ✗ 出错：${e.message}`);
  }
}

/* ---- 按条目 id 直取（权威路径，不受书名歧义影响） ---- */
if (subjects.length) {
  for (const id of subjects) {
    await show(`subject/${id}`, `https://book.douban.com/subject/${id}/`);
    await sleep(1400);
  }
}

/* ---- 按书名检索（可能有歧义，优先用 --subject） ---- */
for (const title of titles) {
  if (!QUIET) {
    console.log('');
    console.log('  ══════════════════════════════════════════════════════════');
    console.log(`  ${title}`);
    console.log('  ══════════════════════════════════════════════════════════');
  }
  try {
    const suggest = await get(`https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(title)}`, true);
    const list = parseDoubanSuggest(suggest) || [];
    if (!list.length) {
      console.log('  ✗ 检索无结果');
      await sleep(1200);
      continue;
    }
    // 优先取中文条目：标题里含汉字的
    const pick =
      list.find((c) => /[\u4e00-\u9fff]/.test(c.title) && !/[\u3040-\u309f\u30a0-\u30ff]/.test(c.title)) ?? list[0];
    if (!QUIET) console.log(`  条目：${pick.title}（${pick.year ?? '?'}）${pick.author ?? ''}  ${pick.url}`);
    const html = await get(pick.url);
    if (!html) {
      console.log('  ✗ 详情页抓取失败');
      await sleep(1200);
      continue;
    }
    const intro = extractIntro(html);
    if (!intro) console.log('  ✗ 该条目没有内容简介');
    else {
      console.log('');
      console.log(intro);
    }
  } catch (e) {
    console.log(`  ✗ 出错：${e.message}`);
  }
  await sleep(1400);
}

if (!QUIET) {
  console.log('');
  console.log('  ──────────────────────────────────────────────────────────');
  console.log('  ⚠️ 以上原文仅供撰写无剧透梗概时参考，**不要直接写进知识库**。');
  console.log('     写完之后必须跑 `node scripts/check-data.mjs` 过泄底闸门。');
  console.log('');
}
