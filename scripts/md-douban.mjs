#!/usr/bin/env node
/**
 * 豆瓣移动版取书目 `md-douban`
 * ============================
 * **为什么又开一条豆瓣渠道**：本项目的评分与简介长期依赖 `book.douban.com`（条目页）与
 * `subject_suggest`（检索接口）。2026-09 起桌面站整站 `HTTP 403 登录跳转`，
 * 抓取链断掉，库里 1904 部条目的评分停在「暂无数据」，新候选也写不出可核查的梗概。
 *
 * 本脚本走的是**另一条路**：`m.douban.com`（移动版）。实测可达，且条目页带：
 *   · `<meta itemprop="ratingValue">` —— 评分；
 *   · `section-intro_desc` —— **内容简介**（出版社文案，常含泄底，只作撰写依据，绝不入库）；
 *   · `<title>` 与 `meta[name=description]` —— 题名与「作者/出版社」线索，用于**核对不是同名异书**。
 *
 * ⚠️ 三条硬规矩（与 `fetch-blurb.mjs` / `dangdang-lookup.mjs` 相同）：
 *   1. 抓到的简介**只作撰写依据**，必须自己重写 ≤100 字并过 `check-data` 泄底闸门；
 *   2. 判据与来源要写进 `verification.source`，注明是**豆瓣移动版**、条目地址与抓取日期；
 *   3. **必须核对题名（尽量连作者）**——豆瓣检索会给出同名异书，只按第一个结果取会挂错。
 *      本脚本把「题名是否吻合」「作者是否出现」都打印出来，**不吻合就不算命中**。
 *
 * 用法：
 *   node scripts/md-douban.mjs --title 密室之别墅疑案 [--author 贯越]
 *   node scripts/md-douban.mjs --file _dd/pairs.tsv --out _dd/md.tsv [--delay 1500] [--limit 20]
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const OPTS_WITH_VALUE = new Set(['--title', '--author', '--file', '--out', '--delay', '--limit']);
const opts = {};
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  if (OPTS_WITH_VALUE.has(argv[i])) { opts[argv[i]] = argv[i + 1]; i += 1; } else positional.push(argv[i]);
}
const DELAY = Number(opts['--delay'] || '1500');
const OUT = opts['--out'] || '_dd/md-douban.tsv';
const LIMIT = Number(opts['--limit'] || '0');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').replace(/[\s:：·・,，.。()（）[\]【】\-—_/、；;！!？?「」『』"']/g, '').toLowerCase();

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
  return { status: r.status, text: await r.text() };
}

/** 检索页里出现的 subject 链接，按出现顺序去重（第一个通常最相关，但不假设它一定对） */
async function searchIds(title) {
  const { status, text } = await get(`https://m.douban.com/search/?query=${encodeURIComponent(title)}&type=book`);
  if (status !== 200) return { ids: [], status };
  const ids = [];
  for (const m of text.matchAll(/subject\/(\d{5,12})/g)) if (!ids.includes(m[1])) ids.push(m[1]);
  return { ids, status };
}

function pick(html, re) {
  const m = html.match(re);
  return m ? m[1].trim() : '';
}

async function fetchSubject(id) {
  const { status, text: html } = await get(`https://m.douban.com/book/subject/${id}/`);
  if (status !== 200) return { status, id };
  const title = pick(html, /<title>\s*([^<]*?)\s*-\s*图书/) || pick(html, /<title>\s*([^<]*?)\s*-\s*豆瓣/);
  const rating = pick(html, /itemprop="ratingValue"\s+content="([\d.]+)"/);
  const ratingCount = pick(html, /([\d,]+)\s*人评价/) || pick(html, /itemprop="ratingCount"\s+content="([\d,]+)"/);
  const desc = pick(html, /<meta itemprop="description" content="([^"]*)"/);
  // 内容简介：整段取下来，去掉 <br/>
  const introRaw = pick(html, /<p class="section-intro_desc"[^>]*>([\s\S]*?)<\/p>/);
  const intro = introRaw.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const publisher = pick(html, /出版社:?\s*<\/span>\s*<span[^>]*>([^<]+)/) || pick(html, /出版社[：:]\s*([^<\n]{2,30})/);
  const year = pick(html, /出版年:?\s*<\/span>\s*<span[^>]*>([^<]+)/) || pick(html, /出版年[：:]\s*([^<\n]{2,20})/);
  /**
   * 作者：移动版把「作者」放在 `subject-info` 一栏的链接里，写法是
   * `<span class="subject-info_label">作者</span><span class="subject-info_value"><a href="...">贯越</a></span>`。
   * 只从简介正文里找作者会漏判（简介常不写作者名），所以这里把整页 HTML 也留下来做兜底比对。
   */
  const authorText = [
    ...subAll(html, /subject-info_label[^>]*>\s*作者\s*<\/span>([\s\S]{0,300}?)<\/li>/g),
    ...subAll(html, /subject-info_label[^>]*>\s*作者\s*<\/span>([\s\S]{0,300}?)<\/div>/g),
  ].join(' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { status, id, title, rating, ratingCount, intro, publisher, year, desc, authorText, html, url: `https://m.douban.com/book/subject/${id}/` };
}

/** 取所有匹配的第一个捕获组 */
function subAll(text, re) {
  const out = [];
  for (const m of text.matchAll(re)) out.push(m[1] || '');
  return out;
}

function judge(wantTitle, wantAuthor, got) {
  const t = norm(got.title);
  const w = norm(wantTitle);
  /** 题名吻合分两档：**完全相等**，或（一方包含另一方时）必须作者也对得上 */
  const exact = !!t && !!w && t === w;
  const loose = !!t && !!w && (t.includes(w) || w.includes(t));
  const key = norm(wantAuthor).slice(0, 3);
  const authorOk =
    !!wantAuthor &&
    (norm(got.authorText).includes(key) || norm(got.desc).includes(key) || norm(got.intro).includes(key) || norm(got.html).includes(key));
  return { titleOk: exact || (loose && authorOk), exact, authorOk };
}

async function one(wantTitle, wantAuthor) {
  const { ids, status } = await searchIds(wantTitle);
  if (!ids.length) return { hit: false, note: `检索无 subject 链接（HTTP ${status}）`, wantTitle, wantAuthor };
  let titleOnly = null;
  for (const id of ids.slice(0, 3)) {
    await sleep(DELAY);
    const got = await fetchSubject(id);
    if (got.status !== 200) continue;
    const { titleOk, authorOk, exact } = judge(wantTitle, wantAuthor, got);
    /**
     * 题名吻合**且**页面出现该作者 → 直接算命中。
     * 题名**完全相等**但页面上找不到作者名 → 记为 `题名吻合(作者未核)`，由人打开条目地址确认后再用。
     * 题名只是「包含」而作者对不上 → 一律不算（《赴宴》会命中毛姆《赴宴之前》，正是这类假阳性）。
     */
    if (titleOk && authorOk) return { hit: true, ...got, wantTitle, wantAuthor };
    if (exact && !titleOnly) titleOnly = { hit: false, note: '题名完全吻合但页面未出现该作者，需人工打开条目地址确认', ...got, wantTitle, wantAuthor };
  }
  if (titleOnly) return titleOnly;
  await sleep(DELAY);
  const first = await fetchSubject(ids[0]);
  return { hit: false, note: `题名或作者不吻合（首个结果：《${first.title || '?'}》）`, wantTitle, wantAuthor, firstTitle: first.title };
}

const tasks = [];
if (opts['--title']) tasks.push([opts['--author'] || '', opts['--title']]);
if (opts['--file']) {
  for (const line of readFileSync(opts['--file'], 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const c = line.split('\t');
    tasks.push([c[0] || '', c[1] || c[0]]);
  }
}
if (!tasks.length) {
  console.log('\n  用法：node scripts/md-douban.mjs --title 密室之别墅疑案 [--author 贯越]');
  console.log('        node scripts/md-douban.mjs --file _dd/pairs.tsv --out _dd/md.tsv [--delay 1500]\n');
  process.exit(1);
}
const list = LIMIT ? tasks.slice(0, LIMIT) : tasks;

const done = new Set();
if (existsSync(OUT) && opts['--file']) {
  for (const l of readFileSync(OUT, 'utf8').split(/\r?\n/)) if (l.trim()) done.add(l.split('\t')[1]);
}
console.log(`待取 ${list.length} 条 → ${OUT}\n`);
let ok = 0;
let miss = 0;
for (const [author, title] of list) {
  if (done.has(title)) continue;
  let rec;
  try {
    rec = await one(title, author);
  } catch (e) {
    rec = { hit: false, note: `失败：${e.message}`, wantTitle: title, wantAuthor: author };
  }
  if (rec.hit) ok += 1; else miss += 1;
  const row = [
    title, rec.hit ? '命中' : '未命中', rec.rating || '', rec.ratingCount || '', rec.publisher || '', rec.year || '',
    rec.intro || '', rec.note || '', rec.url || '', author,
  ].join('\t').replace(/[\r\n]+/g, ' ');
  if (opts['--file']) appendFileSync(OUT, row + '\n', 'utf8');
  else writeFileSync(OUT, '题名\t结果\t评分\t评价人数\t出版社\t出版年\t内容简介\t备注\t条目地址\t查询作者\n' + row + '\n', 'utf8');
  console.log(`${rec.hit ? '✓' : '·'} ${title} ｜ ${rec.rating || '—'} 分 ${rec.ratingCount ? `(${rec.ratingCount}人)` : ''} ｜ ${(rec.intro || rec.note || '').slice(0, 70)}…`);
  await sleep(DELAY);
}
console.log(`\n命中 ${ok} ／ 未命中 ${miss}　→ ${OUT}`);
