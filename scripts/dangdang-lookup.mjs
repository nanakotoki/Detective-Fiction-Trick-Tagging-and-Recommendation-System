#!/usr/bin/env node
/**
 * 当当书目速查（豆瓣与馆藏都不可用时的**第三条来源**）
 * ==================================================
 * 为什么需要它：本项目取书目与简介长期依赖两条外源——豆瓣（条目页）与扬州市图书馆
 * OPAC（编目提要）。2026-09 这两条**同时**不可用：豆瓣整站 `HTTP 403 登录跳转页`，
 * 馆藏 `opac.yzlib.cn` 被本项目的全量扫描打到整站拒连。于是找第三条。
 *
 * 当当可达，且能提供：
 *   · **检索结果页**：书名、**短简介（`p.detail`）**、作者/出版社行、定价——够判「是不是推理」；
 *   · **商品详情页**：出版社、出版时间、ISBN、**内容简介**——够写梗概与核版本年。
 *
 * ⚠️ 三条硬规矩（与 `fetch-blurb.mjs`／`opac-verify.mjs` 相同）：
 *   1. 抓到的简介是**出版社营销文案**，常直接写出凶手、手法与结局。
 *      它**只作撰写依据，绝不入库**；必须自己重写 ≤100 字并过 `check-data` 泄底闸门。
 *   2. 判据要写进 `verification.source`，注明来源是当当、商品页地址与抓取日期。
 *   3. 当当**不是**权威编目数据（没有中图法／主题词），所以它**不能替代**题材判据，
 *      只能补简介与出版信息。题材判据仍以 `opac-verify.mjs` 的中图法／学科主题为准。
 *
 * 用法：
 *   node scripts/dangdang-lookup.mjs 柏林黄昏
 *   node scripts/dangdang-lookup.mjs --author 连城三纪彦 柏林黄昏
 *   node scripts/dangdang-lookup.mjs --page 29778139      直接取商品详情页
 */

import { writeFileSync } from 'node:fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const argv = process.argv.slice(2);
const ai = argv.indexOf('--author');
const pi = argv.indexOf('--page');
const authorFilter = ai !== -1 ? argv[ai + 1] : '';
const pageId = pi !== -1 ? argv[pi + 1] : '';
let titles = argv.filter((a, i) => !a.startsWith('--') && !(ai !== -1 && i === ai + 1) && !(pi !== -1 && i === pi + 1));

if (!titles.length && !pageId) {
  console.log('\n  用法：node scripts/dangdang-lookup.mjs <书名...> | --page <商品 id> [--author <作者>]\n');
  process.exit(1);
}

const strip = (s) =>
  String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();

/** 当当是 GB2312；Node 自带 full-icu，TextDecoder('gbk') 可直接解 */
async function fetchDecoded(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 2000).toString('latin1');
  const m = head.match(/charset=["']?([\w-]+)/i);
  const cs = (m ? m[1] : 'utf-8').toLowerCase();
  let text;
  try {
    text = new TextDecoder(cs === 'gb2312' || cs === 'gbk' ? 'gbk' : cs).decode(buf);
  } catch {
    text = buf.toString('utf8');
  }
  return { status: res.status, text };
}

/** 解析检索结果页：每个 <li id="p<id>"> 里的书名、短简介、作者/出版社行 */
function parseSearch(text) {
  const out = [];
  const liRe = /<li[^>]*id="p(\d+)"[^>]*>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(text))) {
    const id = m[1];
    const li = m[2];
    const titleAttr = li.match(/<p class="name"[^>]*>\s*<a[^>]*title="([^"]*)"/);
    const detail = li.match(/<p class="detail"\s*>([\s\S]*?)<\/p>/);
    const author = li.match(/<p class="search_book_author"\s*>([\s\S]*?)<\/p>/);
    const title = strip(titleAttr ? titleAttr[1] : '');
    if (!title) continue;
    out.push({
      id,
      title,
      detail: detail ? strip(detail[1]) : '',
      authorLine: author ? strip(author[1]) : '',
    });
  }
  return out;
}

/** 解析商品详情页的关键区块 */
function parseProduct(text) {
  const grab = (label, len = 400) => {
    const i = text.indexOf(label);
    if (i < 0) return '';
    return strip(text.slice(i + label.length, i + label.length + len)).replace(/^[:：]\s*/, '');
  };
  const intro = (() => {
    // 详情页的「内容简介」通常在 <div class="descrip"> 或 id="content" 里
    for (const re of [/<div[^>]*class="[^"]*descrip[^"]*"[^>]*>([\s\S]*?)<\/div>/i, /id="content"[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i]) {
      const m = text.match(re);
      if (m && strip(m[1]).length > 40) return strip(m[1]);
    }
    return '';
  })();
  return {
    title: strip((text.match(/<h1[^>]*title="([^"]*)"/) || [, ''])[1]),
    publisher: grab('出版社'),
    pubDate: grab('出版时间', 40),
    isbn: grab('ISBN', 40),
    intro,
  };
}

if (pageId) {
  const { status, text } = await fetchDecoded(`http://product.dangdang.com/${pageId}.html`);
  const p = parseProduct(text);
  console.log(`\n【${pageId}】HTTP ${status}`);
  console.log(`  书名　：${p.title || '(未取到)'}`);
  console.log(`  出版社：${p.publisher || '(未取到)'}`);
  console.log(`  出版时间：${p.pubDate || '(未取到)'}`);
  console.log(`  ISBN　：${p.isbn || '(未取到)'}`);
  console.log(`  内容简介（**只作依据，须自行重写**）：\n${p.intro || '(未取到)'}`);
  writeFileSync(`data/_dd-${pageId}.html`, text, 'utf8');
  process.exit(0);
}

for (const t of titles) {
  const url = `http://search.dangdang.com/?key=${encodeURIComponent(t)}&act=input`;
  let text;
  try {
    ({ text } = await fetchDecoded(url));
  } catch (e) {
    console.log(`\n【${t}】检索失败：${e.message}`);
    continue;
  }
  let rows = parseSearch(text);
  /**
   * 当当检索是**模糊**的：查「一具尸体太多」会返回 60 条《夏天、烟火和我的尸体》之类的无关书。
   * 所以除了总数，还要统计**题名真正包含检索词**的条数——判断「这本书到底有没有上架」
   * 靠的是后者，不是总数。
   */
  const exact = rows.filter((r) => r.title.includes(t));
  if (authorFilter) {
    const hit = rows.filter((r) => r.title.includes(authorFilter) || r.authorLine.includes(authorFilter));
    if (hit.length) rows = hit;
  }
  console.log(
    `\n【${t}】命中 ${rows.length} 条${authorFilter ? `（已按「${authorFilter}」过滤）` : ''}` +
      `${rows.length ? `，其中题名包含「${t}」的 ${exact.length} 条` : ''}`
  );
  for (const r of rows.slice(0, 6)) {
    console.log(`  · ${r.title}`);
    if (r.authorLine) {
      // 作者行里带「/2010-02-01 /吉林出版集团」这样的出版信息，单独抽出来省得肉眼找
      const d = r.authorLine.match(/(\d{4}-\d{2}-\d{2})/);
      const pub = r.authorLine.match(/\/\s*([^/]{2,30}?(?:出版社|出版公司|书局|书店|集团))\s*$/);
      console.log(`     ${r.authorLine}`);
      if (d || pub) {
        console.log(`     ▶ 出版：${d ? d[1] : '?'}${pub ? `　${pub[1]}` : ''}`);
      }
    }
    if (r.detail) console.log(`     短简介：${r.detail}`);
    console.log(`     商品 ${r.id}　→ node scripts/dangdang-lookup.mjs --page ${r.id}`);
  }
  if (!rows.length) console.log('  ⚠ 当当也没结果（换个写法再试，或该书确实未上架）');
}
console.log('');
