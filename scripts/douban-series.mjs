#!/usr/bin/env node
/**
 * 豆瓣丛书（丛书页）枚举
 * ====================
 * 解决的问题：**列不出某套丛书/某位作者的中文书目**。
 *
 * 之前试过的路都不通：`subject_suggest` 只按书名检索；传作者名只返回作者节点；
 * `/author/<id>/` 与 `/author/<id>/works` 返回反爬页或 404。
 * 于是收录只能靠「猜书名」，而猜书名天然列不全——加德纳的「梅森探案集」
 * 中文版有二十卷以上，靠猜只能找到五卷。
 *
 * 这条路是通的：**书籍详情页里有「丛书」链接**，指向
 * `book.douban.com/series/<id>/`，丛书页会列出该丛书下的全部书目（分页）。
 * 群众出版社的「梅森探案集」、吉林出版集团的「日本推理名作选」等
 * 都是带丛书号的，可以直接枚举。
 *
 * 用法：
 *   node scripts/douban-series.mjs --from-book "梅森探案集  移花接木  别墅疑云"
 *   node scripts/douban-series.mjs --series 12345           直接给丛书 id
 *   node scripts/douban-series.mjs --from-book "..." --json
 *   node scripts/douban-series.mjs --from-book "..." --check  顺带跑入库前查重
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDoubanSuggest } from '../web/js/core/ratings.js';
import { normText } from './lib/dup-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const argv = process.argv.slice(2);
const val = (flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1];
};
const AS_JSON = argv.includes('--json');
const DO_CHECK = argv.includes('--check');

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

const decode = (s) =>
  String(s ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '')
    .trim();

/* ---------------- 1. 从书目页找出丛书 id ---------------- */
let seriesId = val('--series');
let seriesName = null;

if (!seriesId) {
  const title = val('--from-book');
  if (!title) {
    console.log('\n  用法：--from-book "<书名>" 或 --series <丛书 id>\n');
    process.exit(1);
  }
  const suggest = await get(`https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(title)}`, true);
  const list = parseDoubanSuggest(suggest) || [];
  const pick = list.find((c) => /[\u4e00-\u9fff]/.test(c.title) && !/[\u3040-\u309f\u30a0-\u30ff]/.test(c.title)) ?? list[0];
  if (!pick) {
    console.error(`  ✗ 检索不到《${title}》`);
    process.exit(1);
  }
  console.log(`\n  条目：${pick.title}  ${pick.url}`);
  await sleep(1200);
  const html = await get(pick.url);
  if (!html) {
    console.error('  ✗ 详情页抓取失败');
    process.exit(1);
  }
  const m = html.match(/href="https:\/\/book\.douban\.com\/series\/(\d+)\/?"[^>]*>([^<]*)</);
  if (!m) {
    console.error('  ✗ 该条目没有关联丛书（或页面结构变化）');
    process.exit(1);
  }
  seriesId = m[1];
  seriesName = decode(m[2]);
  console.log(`  丛书：${seriesName || '(未命名)'}  id=${seriesId}`);
  await sleep(1200);
}

/* ---------------- 2. 翻页枚举丛书书目 ---------------- */
const books = [];
for (let page = 1; page <= 20; page += 1) {
  const html = await get(`https://book.douban.com/series/${seriesId}/?page=${page}`);
  if (!html) break;
  // 丛书页每条是 <li class="subject-item">，书名在 <h2> 里的
  //   <a href="https://book.douban.com/subject/NNN/" title="书名">
  // 注意不能直接匹配全页的 subject/(\d+)：封面链接 <a class="nbg"> 也指向同一
  // 条目但没有 title，且详情区还有别的 subject 链接，会抓错。
  const re = /<h2>[\s\S]{0,300}?<a href="https:\/\/book\.douban\.com\/subject\/(\d+)\/?" title="([^"]*)"/g;
  // 作者行：<div class="pub">作者 / 出版社 / 年份 / 定价</div>
  const pubRe = /<div class="pub">\s*([\s\S]{0,300}?)<\/div>/g;
  const pubs = [];
  let pm;
  while ((pm = pubRe.exec(html)) !== null) pubs.push(decode(pm[1].replace(/\s+/g, ' ')));
  let m;
  let found = 0;
  while ((m = re.exec(html)) !== null) {
    books.push({ subjectId: m[1], title: decode(m[2]), pub: pubs[found] ?? '' });
    found += 1;
  }
  if (!found) break;
  await sleep(1200);
}

if (!books.length) {
  console.error('  ✗ 丛书页没有解析出书目（可能是页面结构变化）');
  process.exit(1);
}

/* ---------------- 3. 与知识库对比 ---------------- */
const have = new Set();
if (DO_CHECK || !AS_JSON) {
  for (const f of fs.readdirSync(BOOKS_DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
    const arr = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, f), 'utf8'));
    if (!Array.isArray(arr)) continue;
    for (const b of arr) {
      for (const t of [b.title, ...(b.alternateTitles ?? [])]) {
        const k = normText(t);
        if (k) have.add(k);
      }
    }
  }
}

if (AS_JSON) {
  console.log(JSON.stringify({ seriesId, seriesName, count: books.length, books }, null, 2));
  process.exit(0);
}

console.log('');
console.log('  丛书书目');
console.log('  ────────────────────────────────────────────');
console.log(`  共 ${books.length} 部`);
console.log('');
const missing = [];
for (const b of books) {
  const owned = have.has(normText(b.title));
  if (!owned) missing.push(b);
  console.log(`      ${owned ? '✓ 在库' : '✗ 未收'}  ${b.title}${b.pub ? `   [${b.pub.split('/')[0].trim()}]` : ''}   (subject/${b.subjectId})`);
}
console.log('');
console.log(`  未收录 ${missing.length} 部 / 共 ${books.length} 部`);
if (missing.length) {
  console.log('');
  console.log('  可直接喂给探测脚本的清单（每行一个书名）：');
  for (const b of missing) console.log(`      ${b.title}`);
}

/* ---------------- 可选：导出待办队列 ---------------- */
const outIdx = argv.indexOf('--out');
if (outIdx !== -1 && argv[outIdx + 1]) {
  const outPath = argv[outIdx + 1];
  const rows = missing.map((b) => {
    // pub 形如「作者 / 出版社 / 年份 / 定价」，取第一段当作者
    const author = (b.pub || '').split('/')[0].trim();
    return { title: b.title, subjectId: b.subjectId, author };
  });
  const lines = [
    `# 丛书待办：${seriesName || ''}（id=${seriesId}）`,
    `# 共 ${books.length} 部，未收 ${rows.length} 部`,
    '# 生成：node scripts/douban-series.mjs --series ' + seriesId + ' --out <本文件>',
    '# 写入前必须：① 用 --subject <subjectId> 抓内容简介；② 逐条跑 check-new 查重；',
    '#              ③ 自己重写无剧透梗概（≤100 字）后过 check-data 泄底闸门。',
    '',
    ...rows.map((r) => `${r.subjectId}\t${r.author}\t${r.title}`),
  ];
  fs.writeFileSync(path.resolve(ROOT, outPath), `${lines.join('\n')}\n`, 'utf8');
  console.log('');
  console.log(`  ✓ 待办队列已写出：${outPath}（${rows.length} 条，制表符分隔：subjectId / 作者 / 书名）`);
}
console.log('');
