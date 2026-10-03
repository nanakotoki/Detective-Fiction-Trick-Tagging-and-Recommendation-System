#!/usr/bin/env node
/**
 * 封面抓取（第 166 轮新增）
 * ========================
 * 目的：给知识库里每一部作品配一张**真实封面**，本地化存到 `web/covers/<id>.webp`，
 * 并把「这张图是从哪儿来的、对不对得上所收版本」逐条记进 `data/covers.json`。
 *
 * 为什么本地化而不是直接写豆瓣的图片外链
 * ------------------------------------
 * 1. 豆瓣图片 CDN **要求带 referer**（实测无 referer → HTTP 418），把外链写进页面等于
 *    把「能不能显示封面」押在对方随时可改的防盗链策略上；
 * 2. 本地文件**离线可用**，页面也不再为每张缩略图多打一次跨站请求；
 * 3. 本项目一直的规矩是**数据自洽**：图片连同它的出处一起进仓库，可复核、可重跑。
 *
 * 取图两条通道（按可靠性排序）
 * --------------------------
 * · **强链接**：知识库该条的 `ratings.douban.subjectId` —— 那就是当初取评分的那条豆瓣条目。
 *   先走 `j/subject_suggest`（按书名检索，回执里带 `pic` 与 `id`），命中同 `id` 的候选即取它的 `pic`；
 *   检索里找不到这条 id 时，退回抓条目页 HTML，从 `#mainpic` 里取图。
 * · **弱链接**：没有 subjectId 的条目，按书名检索，**要求候选书名与库内题名一致**，
 *   并优先选出版年与 `editionYear` 相同的候选；报告与索引里标明「弱链接」。
 * · **书号通道**（`--source isbn`）：`book.douban.com/isbn/<isbn>/` 会**直接跳到该 ISBN 的条目页**。
 *   ISBN 从 `verification.source` 里抠（本库逐条记着馆藏著录的书号）。这条比题名检索更强——
 *   它认的是**版本**，且能救回 suggest 索引里没有的那些条目（`isbn` 判据也写进索引）。
 *   取到条目页后会**核对页面上的 ISBN 是否与所查一致**，不一致就放弃（宁可没有，不可配错版）。
 *   另外会识别豆瓣自己的「暂无封面」默认图，遇到它一律当作「没有封面」。
 *
 * 图片规格
 * ------
 * 豆瓣把同一张图按 `s`(270px) / `m`(540px) / `l`(600–1080px) 三档提供。
 * 本库选 **`s` 档 + webp**（实测比同档 jpg 小约 25%，270px 宽在书卡与详情页都够用）：
 * 全库三千余部按此估算约 60–80MB，是「画质够用」与「仓库别爆炸」之间取的那一点。
 *
 * 用法
 * ----
 *   node scripts/fetch-covers.mjs --limit 20              先抓 20 部看看效果
 *   node scripts/fetch-covers.mjs --book aosaki-001       只抓一部
 *   node scripts/fetch-covers.mjs --missing               只补还没有封面的（增量，可反复跑）
 *   node scripts/fetch-covers.mjs --missing --source isbn 只走书号直达（专治 suggest 索引缺条目的那批）
 *   node scripts/fetch-covers.mjs --prefer-newest         **版本择优**：把老版封面换成新版（见下）
 *   node scripts/fetch-covers.mjs --missing --checkpoint 50 --time-budget 25
 *   node scripts/fetch-covers.mjs --index-only            不联网，按磁盘上的图片重建索引与清单
 *
 * 版本择优（`--prefer-newest`，第 168 轮）
 * -------------------------------------
 * 起因是用户的一句要求：**「我希望你最好选择更新版本的封面，而不是用老的。」**
 * 第一轮抓封面时，强链接优先用「取评分的那条豆瓣条目」，而评分条目是**评价人数最多**的那一版——
 * 对老书来说往往就是**最老的那一版**（《狱门岛》库内收 2021 版，封面却是 2012 版）。
 *
 * 于是补一条择优规则（**只用题名＋作者都对得上的候选**，避免配到同名的另一本书）：
 *   1. 有候选与本库 `editionYear` **同年** → 用它（既是新版，又与所收版本一致）；
 *   2. 否则取**年份最新**的那一条；
 *   3. 与现有封面比，**只在确实更新（或现有那张年份不明）时才替换**，绝不反向换成更老的。
 * 替换时把原封面的出处记进 `replacedFrom`，台账里能看出「这张是从哪张换过来的」。
 *
 * 规矩（与取评分／原作名同一套）
 * --------------------------
 * · **不编造**：抓不到就记 `misses` 并明说原因，页面上用统一的占位图；
 * · **不覆盖已有封面**（除 `--force`），增量补抓可反复跑；
 * · **有礼貌**：默认 900ms/部，连续失败 8 次即熔断退出（多半是被挡了，继续跑只会更糟）；
 * · **分段落盘**：`--checkpoint N` 每 N 部写一次索引，长批次被打断也不至于整批白跑。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');
const COVERS_DIR = path.join(ROOT, 'web', 'covers');
const INDEX_FILE = path.join(ROOT, 'data', 'covers.json');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const C = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
};
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

/**
 * 每部作品最多留几个版本的封面（第 169 轮）。
 *
 * 用户的期望是「尽量放好几个版本的封面，但外面只显示最新的那个」。
 * 豆瓣 works 页给出的版本常有十几个（含台版、外文版、重印本），全存下来仓库要涨到几百 MB，
 * 所以留 3 个：**最新的一版**（外面显示的那张）、**本库所收的那一版**（著录对得上的）、
 * 以及**次新的一版**（让「版本历史」看得出变化）。其余版本在页面上只列年份与出版社，不存图。
 */
/**
 * 每部作品最多留几个版本的封面（第 169 轮）——数值在 `args` 之后解析，见 MAX_EDITIONS
 */


/** 这一页是不是豆瓣的限流拦截页（纯函数在 lib 里，可单测） */
const blockPage = (html, status) => isBlockPage(html, status);

/* ------------------------------------------------------------------ */
/* 参数                                                                */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const value = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i === -1 ? fallback : argv[i + 1];
};

const args = {
  limit: Number(value('--limit', '0')) || 0,
  bookId: value('--book', null),
  delay: Math.max(150, Number(value('--delay', '900')) || 900),
  timeout: Number(value('--timeout', '20000')) || 20000,
  checkpoint: Math.max(0, Number(value('--checkpoint', '50')) || 50),
  timeBudgetMs: Math.max(0, Number(value('--time-budget', '0')) || 0) * 60 * 1000,
  /**
   * 走哪条通道：
   *   all（默认）＝题名检索优先，失败再走书号直达——两条都试，覆盖最全；
   *   suggest     ＝只走题名检索；
   *   isbn        ＝只走书号直达（专治 suggest 索引缺条目的那批）。
   */
  source: ['suggest', 'isbn', 'all', 'weread'].includes(value('--source', 'all')) ? value('--source', 'all') : 'all',
  missingOnly: argv.includes('--missing'),
  /**
   * 已知落空的书要不要重试。
   *
   * 默认跳过（与 `refresh-ratings.mjs` 的 `--skip-known-misses` 同一套考虑）：
   * 索引 `misses` 里记过的多半是**内容层面的落空**（豆瓣确实没有这一版），
   * 重跑一遍只是白花请求；加了新通道（比如本轮的书号通道）才值得用 `--retry-misses` 重来一遍。
   */
  retryMisses: argv.includes('--retry-misses'),
  /**
   * 只重抓「封面与所收版本年份不一致」的那些（配合 `--source isbn`）。
   *
   * 题名检索命中的常常是**豆瓣上评价人数最多的那一版**，而库内收的可能是另一版
   * （例如《狱门岛》库内收 2021 版、豆瓣那一条是 2012 版）。
   * 书号通道认的是版本，正好用来把这类封面换成**所收那一版的封面**。
   */
  fixYearMismatch: argv.includes('--fix-year-mismatch'),
  /**
   * **版本择优**（第 168 轮，用户要求「选更新版本的封面，而不是用老的」）。
   *
   * 只挑「现有封面与所收版本年份不一致、或有一方没记年份」的那些去重挑：
   * 有同年的一条就用同年那条，否则用最新的一条，且**绝不换成更老的**。
   */
  preferNewest: argv.includes('--prefer-newest'),
  /**
   * **多版本封面**（第 169 轮，用户要求「尽量放好几个版本的封面，但外面只显示最新的」）。
   *
   * 走 works 页把同一部作品的各版本摊开，最多留 `--max-editions`（默认 3）张：
   * 最新的（主图）、本库所收的、次新的。其余版本只记年份与出版社，不存图。
   */
  editions: argv.includes('--editions'),
  /** 只把现有记录转成新的 `editions` 结构（不联网），用于结构迁移 */
  seedEditions: argv.includes('--seed-editions'),
  /**
   * **节流：每处理 N 部就歇 M 毫秒**（第 175 轮加）。
   *
   * 起因：豆瓣的 HTML 页有**累计配额**——实测两轮都在「约 2800 次页面请求、约 1 次/秒」之后被限流
   * （返回 3KB 拦截页），而那个配额不会因为单次请求间隔变长就消失，得**跑一段歇一段**。
   * 有了这个开关，就能把它挂在后台整夜跑完，不必半夜起来看它有没有被挡。
   */
  pauseEvery: Math.max(0, Number(value('--pause-every', '0')) || 0),
  pauseMs: Math.max(0, Number(value('--pause-ms', '0')) || 0),
  force: argv.includes('--force'),
  indexOnly: argv.includes('--index-only'),
  quiet: argv.includes('--quiet'),
};
/** 定向抓取（--book/--limit）时把进度打密一点，方便盯 */
const VERBOSE = !args.quiet;

/** 每部作品最多留几个版本的封面（第 169 轮，见文件头「多版本封面」一节） */
const MAX_EDITIONS = (() => {
  const i = argv.indexOf('--max-editions');
  const n = i === -1 ? 3 : Number(argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? Math.min(8, Math.floor(n)) : 3;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startedAt = Date.now();
const timeLeft = () => args.timeBudgetMs > 0 && Date.now() - startedAt > args.timeBudgetMs;

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

let requestCount = 0;

async function httpGet(url, { accept = 'application/json, text/plain, */*', binary = false } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), args.timeout);
  requestCount += 1;
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': UA,
        accept,
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        referer: 'https://book.douban.com/',
      },
    });
    if (!res.ok) return { ok: false, status: res.status, body: null, type: res.headers.get('content-type') || '' };
    if (binary) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { ok: true, status: res.status, buf, url: res.url, type: res.headers.get('content-type') || '' };
    }
    const text = await res.text();
    return { ok: true, status: res.status, text, url: res.url, type: res.headers.get('content-type') || '' };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

/**
 * 封面处理的纯函数（题名褪层、书号折算、主图解析、图片宽高）都在 lib 里——
 * 它们没有副作用，抽出去之后就能进 `test-core.mjs` 的单元测试；
 * 抓取脚本本身没法被 import（顶层就会联网跑起来）。
 */
import {
  normTitle as norm,
  titleQueries,
  parseMainPic,
  isDefaultPic,
  parseInfoLite,
  isbnsOf,
  toIsbn13,
  toWebp,
  imageSize,
  yearOf,
  authorMatches,
  orderEditionsForPrimary,
  pickNewestEdition,
  parseWorksEditions,
  parseWorksLink,
  isBlockPage,
  parseWereadSearch,
  wereadCoverAt,
  pickWereadEditions,
} from './lib/covers.mjs';
import { findFfmpeg, fingerprintsOfFile, fingerprintsOfBuffer, isSameCover } from './lib/image-fp.mjs';
import { parseDoubanOtherEditions } from '../web/js/core/ratings.js';
/* ------------------------------------------------------------------ */
/* 知识库与索引                                                        */
/* ------------------------------------------------------------------ */

function loadBooks() {
  const files = fs.readdirSync(BOOKS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  const books = [];
  for (const file of files) {
    let list;
    try {
      list = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, file), 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(list)) continue;
    for (const book of list) books.push({ file, book });
  }
  return books;
}

function loadIndex() {
  try {
    const idx = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    idx.records = idx.records || {};
    idx.misses = idx.misses || {};
    return idx;
  } catch {
    return {
      format: 'detective-fiction-covers',
      version: 1,
      note:
        '封面索引：每条记录说明这部作品的封面文件、来源条目与同版判据。' +
        '图片本地存放在 web/covers/，文件名即作品 id。missing 里的条目页面上用 web/covers/_placeholder.svg 占位。',
      generatedAt: null,
      records: {},
      misses: {},
    };
  }
}

function saveIndex(idx) {
  idx.generatedAt = new Date().toISOString();
  idx.coverCount = Object.keys(idx.records).length;
  idx.missCount = Object.keys(idx.misses).length;
  fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2) + '\n', 'utf8');
}

/* ------------------------------------------------------------------ */
/* 抓取逻辑                                                            */
/* ------------------------------------------------------------------ */

/** suggest 回执按查询词缓存：同题名的书不少，一次抓完省掉重复请求 */
const suggestCache = new Map();

/** 按书名检索豆瓣候选（回执带 pic / id / year，正是取图需要的三个字段） */
async function suggest(query) {
  if (suggestCache.has(query)) return suggestCache.get(query);
  const url = 'https://book.douban.com/j/subject_suggest?q=' + encodeURIComponent(query);
  const res = await httpGet(url);
  let list = [];
  if (res.ok) {
    try {
      list = JSON.parse(res.text);
    } catch {
      list = [];
    }
  }
  const out = { ok: res.ok, status: res.status, list: Array.isArray(list) ? list.filter((x) => x && x.type === 'b') : [] };
  suggestCache.set(query, out);
  return out;
}

/** 依次用几种题名写法检索，返回第一个「选得出候选」的结果 */
async function suggestBest(book, subjectId) {
  const queries = titleQueries(book.title);
  let last = { ok: true, list: [] };
  for (const [i, q] of queries.entries()) {
    if (i) await sleep(Math.min(args.delay, 400));
    last = await suggest(q);
    const picked = pickCandidate(last.list, book, subjectId);
    if (picked.cand) return { ...last, query: q, ...picked };
  }
  return { ...last, query: queries[0], cand: null, matched: '' };
}

/**
 * 收集**所有**题名写法下的候选（按条目 id 去重），供「版本择优」挑最新的一版。
 *
 * 与 `suggestBest` 的区别：那个要的是「能定下来一本书」，这个要的是「把同一部书的各个版本都摊开」。
 * `stopWhen` 用来提前收手——例如已经出现了与所收版本同年的那一条，就不必再褪层检索了。
 */
async function suggestAll(book, stopWhen = null) {
  const seen = new Map();
  for (const [i, q] of titleQueries(book.title).entries()) {
    if (i) await sleep(Math.min(args.delay, 400));
    const r = await suggest(q);
    for (const c of r.list || []) if (!seen.has(String(c.id))) seen.set(String(c.id), c);
    if (stopWhen && stopWhen([...seen.values()])) break;
  }
  return [...seen.values()];
}

/**
 * 版本择优：在候选里挑**与所收版本同年**的一条，没有就挑**年份最新**的一条。
 *
 * 只用「题名对得上 + 作者对得上」的候选（松判据必须拿作者再核一道，
 * 否则《狗之死》／《豺狗之死》这类会同名不同书）。规则本体在 `lib/covers.mjs`，可单测。
 */

/**
 * 选候选：先认 subjectId（强链接），再认题名，然后看年份，最后才试「副题被省掉」的那种写法。
 * 返回 { cand, matched } —— matched 是写进索引里的「同版判据」。
 */
function pickCandidate(list, book, subjectId) {
  if (!list.length) return { cand: null, matched: '' };
  if (subjectId) {
    const byId = list.find((c) => String(c.id) === String(subjectId));
    if (byId) return { cand: byId, matched: 'subject-id' };
  }
  const want = norm(book.title);
  const sameTitle = list.filter((c) => norm(c.title) === want);
  if (sameTitle.length) {
    const year = String(book.editionYear || '').match(/\d{4}/)?.[0] || '';
    if (year) {
      const sameYear = sameTitle.find((c) => String(c.year || '').includes(year));
      if (sameYear) return { cand: sameYear, matched: subjectId ? 'subject-id-miss+title+year' : 'title+year' };
    }
    return { cand: sameTitle[0], matched: subjectId ? 'subject-id-miss+title' : 'title' };
  }

  /**
   * 兜底：**豆瓣常把副题省掉**。
   *
   * 例：库内《还原犯罪现场.2：雕像血痕》↔ 豆瓣《还原犯罪现场 2》；
   * 反向的（豆瓣比库内长）也见过。但光看题名会配错书——`《狗之死》` 与 `《豺狗之死》`
   * 就是这样一对同名陷阱——所以**必须作者也对得上**才认。
   */
  const normAuthor = (s) =>
    String(s || '')
      .replace(/[\[\]【】()（）\s·・.,，。、:：\-—]/g, '')
      .toLowerCase();
  const a = normAuthor(book.author);
  const prefixHit = list.find((c) => {
    const n = norm(c.title);
    if (n.length < 3 || !a) return false;
    if (!(want.startsWith(n) || n.startsWith(want))) return false;
    const b = normAuthor(c.author_name);
    return Boolean(b) && (a.includes(b) || b.includes(a));
  });
  if (prefixHit) return { cand: prefixHit, matched: subjectId ? 'subject-id-miss+prefix+author' : 'prefix+author' };
  return { cand: null, matched: '' };
}

/** 抓条目页 HTML 取主图（suggest 里找不到该 id 时的退路） */
async function mainPicFromPage(subjectId) {
  const res = await httpGet(`https://book.douban.com/subject/${subjectId}/`, { accept: 'text/html,application/xhtml+xml' });
  if (!res.ok) return { ok: false, status: res.status };
  const url = parseMainPic(res.text);
  if (!url) return { ok: false, status: res.status, reason: '条目页里没有 #mainpic 图片' };
  const titleM = res.text.match(/property="v:itemreviewed"[^>]*>([\s\S]*?)<\/span>/i);
  const yearM = res.text.match(/<span class="pl">\s*出版年[:：]?\s*<\/span>\s*([\s\S]{0,40}?)<br/i);
  return {
    ok: true,
    url,
    title: titleM ? titleM[1].replace(/<[^>]+>/g, '').trim() : '',
    year: yearM ? yearM[1].replace(/<[^>]+>/g, '').trim() : '',
  };
}

/**
 * 下载图片：先试 webp 档，失败退回同 id 的 jpg。
 *
 * 失败时**把最后一次的 HTTP 状态也带回来**——调用方要靠它区分
 * 「这本书在豆瓣没有封面」（404，内容层面的落空）与「通道被挡了」（418／403／429／连不上）。
 */
async function downloadCover(picUrl) {
  const attempts = [];
  const webp = toWebp(picUrl);
  if (webp !== picUrl) attempts.push({ url: webp, ext: 'webp' });
  attempts.push({ url: picUrl, ext: 'jpg' });
  let lastStatus = 0;
  for (const a of attempts) {
    const res = await httpGet(a.url, { accept: 'image/avif,image/webp,image/*,*/*;q=0.8', binary: true });
    lastStatus = res.status || 0;
    if (!res.ok || !res.buf || res.buf.length < 1024) continue;
    const size = imageSize(res.buf);
    const isImage = size.format === 'jpeg' || size.format === 'webp';
    if (!isImage) continue;
    return { ...a, buf: res.buf, ...size, bytes: res.buf.length };
  }
  return { failed: true, status: lastStatus };
}

/** 这个状态码算「通道出问题」而不是「这本书就是没有」 */
const isChannelStatus = (status) => status === 0 || status === 403 || status === 418 || status === 429 || status >= 500;

/**
 * 取一部作品的**全部版本**（豆瓣 works 页），供「多版本封面」挑图。
 *
 * 两步：① 从现有封面那条条目页里找 works 链接（找不到就说明豆瓣没关联其他版本）；
 * ② 打开 works 页并按出版时间排序（新的在前）。
 * 两级都要判「是不是被限流了」——豆瓣对高频访问会返回一个 3KB 的空壳页，
 * 若把它当成「没有 works 页」，就会把整库都记成「没有其他版本」，那是**静默的数据损坏**。
 */
async function collectEditions(book, rec) {
  const empty = { editions: [], blocked: false, note: '' };
  if (!rec?.subjectId) return { ...empty, note: '没有豆瓣条目 id，取不了版本清单' };
  let worksId = rec.worksId || '';
  if (!worksId) {
    await sleep(args.delay);
    const page = await httpGet(`https://book.douban.com/subject/${rec.subjectId}/`, {
      accept: 'text/html,application/xhtml+xml',
    });
    if (!page.ok) return { ...empty, blocked: isChannelStatus(page.status), note: `条目页 HTTP ${page.status}` };
    if (isBlockPage(page.text, page.status)) return { ...empty, blocked: true, note: '条目页返回拦截页' };
    worksId = parseWorksLink(page.text);
  }
  if (!worksId) return { ...empty, note: '该条目没有 works 页（豆瓣未关联其他版本）' };
  await sleep(args.delay);
  const works = await httpGet(`https://book.douban.com/works/${worksId}?order=time`, {
    accept: 'text/html,application/xhtml+xml',
  });
  if (!works.ok) return { ...empty, worksId, blocked: isChannelStatus(works.status), note: `works 页 HTTP ${works.status}` };
  if (isBlockPage(works.text, works.status)) return { ...empty, worksId, blocked: true, note: 'works 页返回拦截页' };
  const editions = parseWorksEditions(works.text);
  return { editions, worksId, blocked: false, note: editions.length ? '' : 'works 页里没有解析出版本' };
}

/* ------------------------------------------------------------------ */
/* 微信读书通道（第 170 轮）                                            */
/* ------------------------------------------------------------------ */

const WEREAD_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const wereadCache = new Map();

/** 微信读书全局检索（JSON，不封；带出版社与译者） */
async function searchWeread(title) {
  const key = String(title || '').trim();
  if (!key) return [];
  if (wereadCache.has(key)) return wereadCache.get(key);
  let list = [];
  /**
   * **必须设超时**：实测这个接口对冷门书名会卡到 60 秒（同一接口热门书名只要 400ms），
   * 不设上限的话一本书就能拖掉一分钟，整库跑起来没法看。8 秒拿不到就当没命中。
   */
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(
      `https://weread.qq.com/web/search/global?keyword=${encodeURIComponent(key)}&maxIdx=0&fragmentSize=120&count=20`,
      {
        signal: ctl.signal,
        headers: { 'user-agent': WEREAD_UA, accept: 'application/json, text/plain, */*', referer: 'https://weread.qq.com/' },
      },
    );
    requestCount += 1;
    if (res.ok) list = parseWereadSearch(JSON.parse(await res.text()));
  } catch {
    list = [];
  } finally {
    clearTimeout(timer);
  }
  wereadCache.set(key, list);
  return list;
}

/** 抓微信读书的封面（CDN 允许直接外链，但仍下载到本地——主图要离线可用） */
async function downloadWereadCover(url, tier = 't5') {
  const big = wereadCoverAt(url, tier);
  if (!big) return null;
  const res = await httpGet(big, { accept: 'image/avif,image/webp,image/*,*/*;q=0.8', binary: true });
  if (!res.ok || !res.buf || res.buf.length < 1024) return { failed: true, status: res.status || 0 };
  const size = imageSize(res.buf);
  if (size.format !== 'jpeg' && size.format !== 'webp') return { failed: true, status: res.status };
  return { url: big, buf: res.buf, ...size, bytes: res.buf.length, ext: 'jpg' };
}

/**
 * 候选版本是不是与**已有的某一版是同一张图**（第 171 轮）。
 *
 * 为什么要前移到写入时：用户反馈「有些放了两版的图其实一模一样」，
 * 一查——撤下的 847 条**全部**是跨站重复（同一张封面豆瓣与微信读书各有一份，
 * 一边带白边书脊、一边是紧裁的电子版），豆瓣侧内部 0 条。
 * 也就是说：**只要多来源并存，跨站重复就是系统性的**，不能靠事后清理兜着。
 * 所以从别的来源拿版本之前，先把图下下来跟已保留的版本比一次，重复的当场就不收。
 *
 * 没有 ffmpeg 时返回 false（不判重）——宁可留着重复，也不在没有依据的情况下丢版本。
 */
async function isVisuallyDuplicateOf(candidate, existing) {
  if (!findFfmpeg() || !candidate?.pic) return false;
  let fp = null;
  try {
    const res = await httpGet(candidate.pic, { accept: 'image/avif,image/webp,image/*,*/*;q=0.8', binary: true });
    if (!res.ok || !res.buf) return false;
    fp = fingerprintsOfBuffer(res.buf, '.jpg');
  } catch {
    return false;
  }
  if (!fp) return false;
  return sameAsAnyLocal(fp, existing);
}

/** 一份已经拿在手里的图片字节，与「已保留的本地版本」比：返回撞上的那一版（没撞上返回 null） */
function localImageDuplicates(buffer, existing) {
  if (!findFfmpeg()) return null;
  const fp = fingerprintsOfBuffer(buffer, '.webp');
  if (!fp) return null;
  return sameAsAnyLocal(fp, existing) || null;
}

/** 指纹与已保留的本地版本逐一比，返回第一张撞上的版本 */
function sameAsAnyLocal(fp, existing) {
  for (const e of existing) {
    if (!e?.file) continue;
    const p = path.join(COVERS_DIR, e.file);
    if (!fs.existsSync(p)) continue;
    if (isSameCover(fp, fingerprintsOfFile(p))) return e;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

const books = loadBooks();
const index = loadIndex();
fs.mkdirSync(COVERS_DIR, { recursive: true });

/**
 * 这部书「已经有封面」了吗？
 *
 * 判据是**索引里有记录且文件在盘上**——不是「盘上有同名文件」。
 * 这样处理有个好处：中途被打断时留下的那些**孤儿文件**（图存下了、索引还没落盘）
 * 不会被当成已完成而永远跳过，重跑时会被重新抓一遍并补上索引；
 * 否则孤儿文件只能靠 `--index-only` 事后补记，而那种补记是**没有出处的**
 * （`matched: unknown`），对这个项目来说等于没有证据。
 */
const hasFile = (id, rec) => Boolean(rec?.file) && fs.existsSync(path.join(COVERS_DIR, rec.file));

/* --index-only：只按磁盘上的图片重建索引（不联网） */
if (args.indexOnly) {
  let added = 0;
  const known = new Set(Object.keys(index.records));
  for (const { book } of books) {
    if (hasFile(book.id) && !known.has(book.id)) {
      const ext = ['webp', 'jpg', 'png'].find((e) => fs.existsSync(path.join(COVERS_DIR, `${book.id}.${e}`)));
      const buf = fs.readFileSync(path.join(COVERS_DIR, `${book.id}.${ext}`));
      const size = imageSize(buf);
      index.records[book.id] = {
        file: `${book.id}.${ext}`,
        bytes: buf.length,
        width: size.width,
        height: size.height,
        format: size.format,
        source: 'local-scan',
        sourceUrl: '',
        subjectId: '',
        matched: 'unknown',
        edition: { title: book.title, author: book.author, year: book.editionYear || '' },
        bookYear: book.editionYear || '',
        yearMatch: null,
        fetchedAt: fs.statSync(path.join(COVERS_DIR, `${book.id}.${ext}`)).mtime.toISOString(),
      };
      added += 1;
    }
  }
  saveIndex(index);
  console.log(`[index-only] 新登记 ${added} 条，索引共 ${Object.keys(index.records).length} 条`);
  process.exit(0);
}

/* --seed-editions：不联网，把现有记录迁移成带 `editions` 的结构（第 169 轮） */
if (args.seedEditions) {
  const bookById = new Map(books.map(({ book }) => [book.id, book]));
  let n = 0;
  for (const [id, rec] of Object.entries(index.records)) {
    if (Array.isArray(rec.editions) && rec.editions.length) continue;
    const book = bookById.get(id);
    const year = yearOf(rec.edition?.year);
    const bookYear = yearOf(book?.editionYear);
    rec.editions = [
      {
        subjectId: rec.subjectId || '',
        file: rec.file,
        title: rec.edition?.title || book?.title || '',
        year: rec.edition?.year || '',
        publisher: '',
        ...(rec.pic ? { pic: rec.pic } : {}),
        bytes: rec.bytes,
        width: rec.width,
        height: rec.height,
        format: rec.format,
        primary: true,
        collected: Boolean(year && bookYear && year === bookYear),
        fetchedAt: rec.fetchedAt,
      },
    ];
    n += 1;
  }
  saveIndex(index);
  console.log(`[seed-editions] 迁移 ${n} 条记录为多版本结构（每条 1 个版本，等抓取补全）`);
  process.exit(0);
}

/* 目标队列 */
let targets = books.map(({ file, book }) => ({ file, book }));
if (args.bookId) targets = targets.filter((t) => t.book.id === args.bookId);
if (args.editions) {
  /**
   * 多版本封面：对**已经有封面**的作品去补它的其他版本。
   * 已经有 `editions` 且版本数够的跳过（增量语义，可反复跑）。
   */
  targets = targets.filter((t) => {
    const rec = index.records[t.book.id];
    if (!rec) return false;
    return (rec.editions?.length || 0) < MAX_EDITIONS;
  });
} else if (args.preferNewest) {
  /**
   * 版本择优：只动**「封面比所收版本老」**的那些（年份都记着、且封面更老）。
   *
   * 为什么只动这一类：
   *   · 「封面已与所收版本同年」→ 已经是最合适的，重挑只会白花请求；
   *   · 「封面比所收版本新」→ 用户要的就是新版，**不能反向换成更老的**；
   *   · 「有一方没记年份」→ 没有比较的基准，硬挑只会引入无据的改动（留给下一轮连同书目信息一起理）。
   */
  targets = targets.filter((t) => {
    const rec = index.records[t.book.id];
    const cy = yearOf(rec?.edition?.year);
    const by = yearOf(t.book.editionYear);
    return Boolean(cy && by) && Number(cy) < Number(by);
  });
} else if (args.fixYearMismatch) {
  // 只挑「已有封面、但那张封面与所收版本年份不一致、且著录里有书号」的
  targets = targets.filter(
    (t) => index.records[t.book.id]?.yearMatch === false && isbnsOf(t.book).length > 0,
  );
} else if (args.missingOnly) {
  targets = targets.filter((t) => !hasFile(t.book.id, index.records[t.book.id]));
}
if (args.force || args.fixYearMismatch || args.preferNewest || args.editions) {
  /* 保留全部 */
} else if (!args.missingOnly) {
  // 默认也跳过已有封面的（增量语义），要重抓请加 --force
  targets = targets.filter((t) => !hasFile(t.book.id, index.records[t.book.id]));
}
if (args.limit) targets = targets.slice(0, args.limit);

/** 已知落空的不再重试（要重试加 --retry-misses） */
const beforeSkip = targets.length;
if (!args.retryMisses && !args.force && !args.fixYearMismatch && !args.preferNewest && !args.editions) {
  targets = targets.filter((t) => !index.misses[t.book.id]);
}
const skippedKnown = beforeSkip - targets.length;

const withSid = targets.filter((t) => t.book.ratings?.douban?.subjectId).length;
console.log('');
console.log(
  color(
    args.editions
      ? `  多版本封面：待处理 ${targets.length} 部（每部最多留 ${MAX_EDITIONS} 个版本）`
      : `  封面抓取：待处理 ${targets.length} 部（其中带强链接 subjectId 的 ${withSid} 部）`,
    C.bold,
  ),
);
console.log(color(`  通道 ${args.source} ｜ 已知落空跳过 ${skippedKnown} 部${args.retryMisses ? '（本轮回试）' : ''}`, C.dim));
console.log(color(`  图片目录 ${path.relative(ROOT, COVERS_DIR)} ｜ 索引 ${path.relative(ROOT, INDEX_FILE)}`, C.dim));
console.log('');

let done = 0;
let okCount = 0;
let skipCount = 0;
/** 版本择优模式下「查过但不必换」的部数（它们本来就有封面，不算落空） */
let keptCount = 0;
/** 多版本模式下「新增的其他版本封面」总数 */
let addedEditionCount = 0;
/** 因判重而删掉的本地其他版本图（含「盘上已有但其实是同一张」的那些） */
let droppedFiles = 0;
let consecutiveFail = 0;
/** 连续多少次「页面被限流」——连续几次就判定豆瓣在限流，主动收手 */
let consecutiveBlocked = 0;
let wrote = false;
const missedThisRun = [];

for (const { book } of targets) {
  if (timeLeft()) {
    console.log(color('  ⏱ 时间预算到，正常收尾（已抓的都会落盘）。', C.yellow));
    break;
  }
  done += 1;
  let subjectId = book.ratings?.douban?.subjectId ? String(book.ratings.douban.subjectId) : '';
  let picUrl = '';
  let matched = '';
  let usedIsbn = '';
  let edition = { title: '', author: '', year: '' };
  let sourceUrl = '';
  let reason = '';
  /** 两条通道各自的落空说明，最后拼成一条 reason——只留一条会丢掉「另一条通道也试过」这个事实 */
  const reasons = [];
  /** 本部是否属于「通道出问题」（网络错、被挡、限流）——只有它才计入熔断 */
  let channelError = false;
  /** 版本择优模式下「现有封面已经是最合适的」——既不重下，也不记落空 */
  let noChange = false;
  /**
   * 多版本模式里**这一部已经处理完了**（版本清单已写进记录）。
   * 后面那段「取图 → 写主图 → 记落空」的通用流程必须跳过，
   * 否则会把刚登记好的书又写进 `misses`（第一版就是这么把自己坑了的）。
   */
  let handled = false;
  /** 通道里已经下好的图（微信读书那条会顺手把图取回来，省一次重复请求） */
  let preSaved = null;

  try {
    /**
     * 多版本封面分支（`--editions`）：只补「其他版本」，主图沿用现有那张。
     *
     * 挑选顺序：**最新的一版**（主图，如果比现有的还新就把它换上来）→ **本库所收那版** →
     * **次新的一版**；最多 `MAX_EDITIONS` 张，其余版本只在页面上列年份与出版社。
     */
    if (args.editions) {
      const rec = index.records[book.id];
      const bookYear = yearOf(book.editionYear);
      const { editions: found, worksId, blocked, note } =
        args.source === 'weread' ? { editions: [], worksId: '', blocked: false, note: '按参数只用微信读书' } : await collectEditions(book, rec);

      /**
       * **微信读书兜底**：豆瓣条目页被限流、或该作品在豆瓣没有 works 页时，
       * 改用微信读书的检索结果当版本清单。它的封面 CDN 允许直接外链，
       * 所以这些版本**只存链接、不落盘**（`remote: true`），页面上按需加载。
       */
      const useWeread = blocked || !found.length || args.source === 'weread';
      let remoteEditions = [];
      if (useWeread && args.source !== 'isbn') {
        const list = await searchWeread(book.title);
        const picks = pickWereadEditions(book, list, { limit: MAX_EDITIONS });
        remoteEditions = picks
          .filter((c) => c.cover)
          .map((c) => ({
            subjectId: c.bookId,
            source: '微信读书',
            remote: true,
            pic: wereadCoverAt(c.cover, 't3'),
            largePic: wereadCoverAt(c.cover, 't9'),
            title: c.title,
            publisher: c.publisher,
            ...(c.translator ? { translator: c.translator } : {}),
            year: '',
          }));
        if (remoteEditions.length) consecutiveBlocked = 0;
      }

      if (blocked && !remoteEditions.length) {
        consecutiveBlocked += 1;
        channelError = true;
        noChange = true;
        reasons.push(`版本清单取不到：${note}（豆瓣限流，微信读书也没有对得上的版本）`);
      } else if (!found.length && !remoteEditions.length) {
        consecutiveBlocked = 0;
        noChange = true;
        // 版本清单本来就没有 → 保留现有记录（并确保结构是新的 editions 数组）
        rec.editions = rec.editions?.length
          ? rec.editions
          : [
              {
                subjectId: rec.subjectId || '',
                file: rec.file,
                title: rec.edition?.title || book.title,
                year: rec.edition?.year || '',
                publisher: '',
                bytes: rec.bytes,
                width: rec.width,
                height: rec.height,
                format: rec.format,
                primary: true,
                collected: Boolean(yearOf(rec.edition?.year) && bookYear && yearOf(rec.edition?.year) === bookYear),
                fetchedAt: rec.fetchedAt,
              },
            ];
        reasons.push(`版本清单：${note || '无其他版本'}`);
      } else {
        consecutiveBlocked = 0;
        if (worksId) rec.worksId = worksId;
        /**
         * 排序：**题名一致、且文字与库内相同的那一版排最前**，其后才是题名一致但文字不同的、
         * 最后才是题名对不上的（外文版）。每层内部仍按出版年降序 —— 「新版优先」在这一层里生效。
         *
         * 第 181 轮的根因修复：原先这里是「所有候选一起按年降序」，于是「最新版」经常是
         * 泰文／俄文／日文版（《占星术杀人魔法》挂泰文封面），而 README §168 明写
         * 「不会拿繁体版／外文版顶掉简体版」。排序规则现在住在 `lib/covers.mjs`
         * 的 `orderEditionsForPrimary()` 里，带单元测试。
         */
        const ordered = orderEditionsForPrimary(found, book.title, { bookYear });
        /** 挑：最新 → 本库所收那版 → 次新 → 再往后补足 */
        const picked = [];
        const push = (e) => {
          if (e && !picked.some((x) => x.subjectId === e.subjectId) && picked.length < MAX_EDITIONS) picked.push(e);
        };
        push(ordered[0]);
        push(bookYear ? ordered.find((e) => yearOf(e.year) === bookYear) : null);
        for (const e of ordered) push(e);

        const outEditions = [];
        /** 写入时就被判为「与已保留版本同一张图」而没收下的（记进 editionsDropped） */
        const autoDropped = [];
        /**
         * 豆瓣这边没有候选（限流、或没有 works 页）时，**先把现有的本地主图放进第一位**：
         * `editions[0]` 必须永远是那张「外面显示的最新版」，后面才轮到其他版本。
         * 少了这一步，纯微信读书的版本会顶到第一位、而它们没有本地文件，记录就写坏了。
         */
        if (!picked.length) {
          const prev = rec.editions?.[0];
          outEditions.push({
            subjectId: prev?.subjectId || rec.subjectId || '',
            file: rec.file,
            title: prev?.title || rec.edition?.title || book.title,
            year: prev?.year || rec.edition?.year || '',
            publisher: prev?.publisher || '',
            ...(prev?.translator ? { translator: prev.translator } : {}),
            ...(prev?.pic ? { pic: prev.pic } : {}),
            bytes: rec.bytes,
            width: rec.width,
            height: rec.height,
            format: rec.format,
            primary: true,
            collected: Boolean(bookYear && yearOf(prev?.year || rec.edition?.year) === bookYear),
            fetchedAt: rec.fetchedAt,
          });
        }
        for (const [i, e] of picked.entries()) {
          const isPrimary = i === 0;
          const file = isPrimary ? rec.file : `${book.id}-${e.subjectId}.webp`;
          const exists = fs.existsSync(path.join(COVERS_DIR, file));
          let meta = null;
          if (isPrimary) {
            // 主图已存在：沿用原文件与原体积信息
            meta = { bytes: rec.bytes, width: rec.width, height: rec.height, format: rec.format };
          } else if (exists) {
            const buf = fs.readFileSync(path.join(COVERS_DIR, file));
            const size = imageSize(buf);
            /**
             * **盘上已有的其他版本也要判重**（第 176 轮补的一刀）。
             *
             * 起因：写入时判重原先只盖住「这次下载的图」这一条路——
             * 而更早的轮次（那时还没有判重）已经把图存到盘上了，重跑时走的是「文件已存在」这条路，
             * 于是那批老文件被原样收进 `editions`，漏网。
             * 实测抓到一例：`facet124-008` 的 2010-10 与 2006-12 两版**指纹完全一致**。
             */
            const sameAsKept = localImageDuplicates(buf, outEditions);
            if (sameAsKept) {
              autoDropped.push({
                title: e.title || book.title,
                year: e.year || '',
                publisher: e.publisher || '',
                sameAs: sameAsKept.title || '',
                why: '与已保留的版本是同一张图（写入时判重·盘上已有文件）',
              });
              if (file !== rec.file) {
                fs.rmSync(path.join(COVERS_DIR, file), { force: true });
                droppedFiles += 1;
              }
              continue;
            }
            meta = { bytes: buf.length, width: size.width, height: size.height, format: size.format };
          } else if (e.pic && !isDefaultPic(e.pic)) {
            await sleep(args.delay);
            const img = await downloadCover(e.pic);
            if (img && !img.failed) {
              /**
               * 本地版本也要判重：豆瓣那边同一个条目 id 之外的「另一个版本」
               * 有可能是**同一张图**（重印本沿用旧封面、或同一版被著录成两条）。
               * 实测出现过「两个 id 的封面逐像素相同」，存下来就是白占体积的重复。
               */
              const sameAsKept = await localImageDuplicates(img.buf, outEditions);
              if (sameAsKept) {
                autoDropped.push({
                  title: e.title || book.title,
                  year: e.year || '',
                  publisher: e.publisher || '',
                  sameAs: sameAsKept.title || '',
                  why: '与已保留的版本是同一张图（写入时判重）',
                });
                continue;
              }
              fs.writeFileSync(path.join(COVERS_DIR, file), img.buf);
              meta = { bytes: img.bytes, width: img.width, height: img.height, format: img.format };
              addedEditionCount += 1;
            } else if (img?.failed && isChannelStatus(img.status)) {
              channelError = true;
            }
          }
          if (!meta) continue; // 没有图就不登记这一版（宁缺毋滥）
          outEditions.push({
            subjectId: String(e.subjectId),
            file,
            title: e.title || book.title,
            year: e.year || '',
            publisher: e.publisher || '',
            ...(e.translator ? { translator: e.translator } : {}),
            ...(e.pic ? { pic: e.pic } : {}),
            bytes: meta.bytes,
            width: meta.width,
            height: meta.height,
            format: meta.format,
            primary: isPrimary,
            collected: Boolean(bookYear && yearOf(e.year) === bookYear),
            fetchedAt: new Date().toISOString(),
          });
        }

        /**
         * 豆瓣这边拿到的版本之外，**再补上微信读书那边的版本**（只要不重复）。
         *
         * 两边记的是同一部作品的不同版本：豆瓣强在「版本全、有出版年」，
         * 微信读书强在「电子版封面清晰、CDN 允许外链」。合并之后版本一览更完整，
         * 而微信读书那几版**只存链接**（`remote: true`），不占仓库。
         */
        for (const r of remoteEditions) {
          if (outEditions.length >= MAX_EDITIONS) break;
          if (outEditions.some((x) => x.title === r.title && x.publisher === r.publisher)) continue;
          /** 先看图：与已保留的某一版是同一张画就不收（跨站重复的根治办法） */
          if (await isVisuallyDuplicateOf(r, outEditions)) {
            autoDropped.push({
              title: r.title || '',
              publisher: r.publisher || '',
              remote: true,
              sameAs: outEditions[0]?.title || '',
              why: '与已保留的版本是同一张图（写入时判重）',
            });
            continue;
          }
          outEditions.push({ ...r, primary: false, collected: false, fetchedAt: new Date().toISOString() });
        }
        if (autoDropped.length) {
          /** 同一条「撤下」记录不要重复累积（反复跑同一部书时） */
          const seen = new Set((rec.editionsDropped || []).map((d) => `${d.title}|${d.publisher}`));
          const fresh = autoDropped.filter((d) => !seen.has(`${d.title}|${d.publisher}`));
          if (fresh.length) rec.editionsDropped = [...(rec.editionsDropped || []), ...fresh];
        }
        if (outEditions.length) {
          /**
           * 主图必须与 `editions[0]` 一致：works 页上若有更新的版本，
           * 就把主图换成它——这正好与「外面只显示最新版」这条要求一致。
           */
          const primary = outEditions[0];
          if (primary.file && primary.file !== rec.file) {
            /** 新主图还没下过（`primary.file` 是 `<id>-<subjectId>.webp`）→ 复制成 `<id>.webp` */
            const src = path.join(COVERS_DIR, primary.file);
            if (fs.existsSync(src)) {
              fs.copyFileSync(src, path.join(COVERS_DIR, `${book.id}.webp`));
              primary.file = `${book.id}.webp`;
            }
          }
          rec.editions = outEditions;
          rec.matched = args.source === 'weread' ? 'editions+weread' : 'editions+works';
          if (primary.file) {
            rec.file = primary.file;
            rec.subjectId = primary.subjectId;
            rec.sourceUrl = `https://book.douban.com/subject/${primary.subjectId}/`;
            rec.edition = { title: primary.title, author: book.author, year: primary.year };
            rec.bytes = primary.bytes;
            rec.width = primary.width;
            rec.height = primary.height;
            rec.format = primary.format;
            rec.yearMatch = primary.year && bookYear ? yearOf(primary.year) === bookYear : null;
          }
          rec.query = `版本一览（${outEditions.length} 版${remoteEditions.length ? '，含微信读书' : ''}）`;
          rec.bookYear = book.editionYear || '';
          rec.fetchedAt = new Date().toISOString();
          delete index.misses[book.id];
          okCount += 1;
          handled = true;
          if (VERBOSE && (done <= 20 || done % 25 === 0)) {
            console.log(
              `  ✓ ${book.id}《${book.title}》留 ${outEditions.length} 版：` +
                outEditions.map((e) => `${e.year || '—'}${e.primary ? '(主)' : ''}`).join(' / ')
            );
          }
        } else {
          noChange = true;
          reasons.push('版本清单：候选版本都没有可用封面');
        }
      }
    } else if (args.preferNewest) {
      const rec = index.records[book.id];
      const bookYear = yearOf(book.editionYear);
      const curId = String(rec?.subjectId || '');

      /**
       * 候选来源有三个：
       *   ① 题名检索（`j/subject_suggest`）——但它**不是全量索引**，常常只回一两个版本；
       *   ② 现有封面那条条目的**其他版本区块**——同一部作品在豆瓣上互链的版本；
       *   ③ **works 页**（`book.douban.com/works/<id>?order=time`）——同一部作品的**全部**版本，
       *      按出版时间排序、新的在前，且每条自带封面图。
       *      「库内收 2021 版、检索却只回 2012 版」这种情形，靠的就是 ③。
       */
      const cands = await suggestAll(book, (list) => Boolean(bookYear) && list.some((c) => yearOf(c.year) === bookYear));
      if (curId && !(bookYear && cands.some((c) => yearOf(c.year) === bookYear))) {
        await sleep(args.delay);
        const page = await httpGet(`https://book.douban.com/subject/${curId}/`, { accept: 'text/html,application/xhtml+xml' });
        if (!page.ok) {
          if (isChannelStatus(page.status)) channelError = true;
        } else {
          // ② 条目页上的「其他版本」链接
          for (const e of parseDoubanOtherEditions(page.text)) {
            if (cands.some((c) => String(c.id) === String(e.subjectId))) continue;
            cands.push({
              id: e.subjectId,
              // 「其他版本」的标签写作「书名 2021」——去掉尾部年份再与库内题名比较
              title: String(e.label || '').replace(/\s*\d{4}(-\d+)?\s*$/, '').trim() || book.title,
              year: yearOf(e.label),
              author_name: book.author,
              pic: '',
              fromOtherEditions: true,
            });
          }
          // ③ works 页（全部版本，按出版时间排序）
          const worksId = parseWorksLink(page.text);
          if (worksId) {
            await sleep(args.delay);
            const worksPage = await httpGet(`https://book.douban.com/works/${worksId}?order=time`, {
              accept: 'text/html,application/xhtml+xml',
            });
            if (worksPage.ok) {
              for (const e of parseWorksEditions(worksPage.text)) {
                if (cands.some((c) => String(c.id) === String(e.subjectId))) continue;
                cands.push({
                  id: e.subjectId,
                  title: e.title,
                  year: e.year,
                  author_name: book.author,
                  pic: e.pic,
                  fromWorks: true,
                });
              }
            } else if (isChannelStatus(worksPage.status)) {
              channelError = true;
            }
          }
        }
      }

      const { cand, how } = pickNewestEdition(book, cands);
      const curYear = yearOf(rec?.edition?.year);
      if (!cand) {
        noChange = true;
        reasons.push(`版本择优：${cands.length} 个候选里没有题名＋作者都对得上的`);
      } else if (String(cand.id) === curId && yearOf(cand.year) === curYear) {
        noChange = true;
        reasons.push('版本择优：现有封面就是最合适的那一条');
      } else if (how === 'edition-year+title' || !curYear || Number(yearOf(cand.year)) > Number(curYear)) {
        /** 取图：检索候选自带 `pic`；「其他版本」来的候选要先开一次条目页取主图 */
        let pic = cand.pic || '';
        if (!pic) {
          await sleep(args.delay);
          const one = await mainPicFromPage(String(cand.id));
          if (one.ok && !isDefaultPic(one.url)) pic = one.url;
          else if (!one.ok && isChannelStatus(one.status)) channelError = true;
        }
        if (!pic) {
          noChange = true;
          reasons.push(`版本择优：选中的 ${yearOf(cand.year) || '年份未标'} 版（条目 ${cand.id}）没有可用的封面图`);
        } else {
          picUrl = pic;
          matched = how;
          edition = { title: cand.title || book.title, author: cand.author_name || book.author, year: cand.year || '' };
          sourceUrl = `https://book.douban.com/subject/${cand.id}/`;
        }
      } else {
        noChange = true;
        reasons.push(`版本择优：最新候选 ${yearOf(cand.year) || '年份未标'} 不比现有封面 ${curYear || '年份未标'} 新`);
      }
    } else if (args.source === 'weread') {
      /**
       * **微信读书通道**（第 170 轮）：豆瓣 HTML 被限流时的替代来源。
       * 检索是按书名的一次 JSON 请求，命中后按 `t5_` 档（214×317）下图存本地；
       * 选不中（题名对不上、或没有作者佐证）就当作没找到——**宁可留占位图，也不配错封面**。
       */
      const picks = pickWereadEditions(book, await searchWeread(book.title), { limit: 1 });
      const pick = picks[0];
      if (!pick) {
        reasons.push('微信读书：没有题名＋作者都对得上的版本');
      } else if (!pick.cover) {
        reasons.push('微信读书：命中条目但没有封面');
      } else {
        const img = await downloadWereadCover(pick.cover, 't5');
        if (img && !img.failed) {
          preSaved = img;
          picUrl = img.url;
          matched = 'weread';
          edition = { title: pick.title, author: pick.author, year: '' };
          sourceUrl = `https://weread.qq.com/web/search/global?keyword=${encodeURIComponent(book.title)}`;
        } else {
          reasons.push(`微信读书：封面下载失败（HTTP ${img?.status || '连不上'}）`);
        }
      }
    } else {
      /**
       * 第一条通道：题名检索（快、覆盖广）。
       * `--source isbn` 时跳过它，直接走书号通道。
       */
      const sg = args.source === 'isbn' ? { cand: null, list: [], query: '' } : await suggestBest(book, subjectId);
      if (sg.ok === false && isChannelStatus(sg.status)) channelError = true;
      const cand = sg.cand;
      if (cand) {
        picUrl = cand.pic || '';
        matched = sg.matched;
        edition = { title: cand.title || '', author: cand.author_name || '', year: cand.year || '' };
        sourceUrl = `https://book.douban.com/subject/${cand.id}/`;
        if (!picUrl) reasons.push('候选条目没有 pic 字段');
      } else if (subjectId && args.source !== 'isbn') {
        await sleep(args.delay);
        const page = await mainPicFromPage(subjectId);
        if (page.ok) {
          picUrl = page.url;
          matched = 'subject-id+page';
          edition = { title: page.title, author: book.author, year: page.year };
          sourceUrl = `https://book.douban.com/subject/${subjectId}/`;
        } else {
          if (isChannelStatus(page.status)) channelError = true;
          reasons.push(page.reason || `条目页取图失败（HTTP ${page.status}）`);
        }
      } else {
        reasons.push(sg.list?.length ? '检索有候选但题名都不一致' : '检索无候选');
      }
    }

    /**
     * 第二条通道：**书号**。
     *
     * `book.douban.com/isbn/<isbn>/` 会直接跳到该 ISBN 的条目页——比题名检索强，
     * 因为它认的是书号（版本），不是书名。isbn 从 `verification.source` 里抠。
     * 取到条目页后**逐条核对 ISBN 是否一致**：不一致说明豆瓣那一条不是这一版，宁可不要。
     */
    if (!handled && !picUrl && (args.source === 'isbn' || args.source === 'all')) {
      const isbns = isbnsOf(book);
      const wantYear = String(book.editionYear || '').match(/\d{4}/)?.[0] || '';
      /** 一条书号查下来的候选（可能有多个：著录里同时记着初版与所收版的号） */
      const found = [];
      for (const isbn of isbns.slice(0, 3)) {
        await sleep(args.delay);
        const res = await httpGet(`https://book.douban.com/isbn/${isbn}/`, { accept: 'text/html,application/xhtml+xml' });
        if (!res.ok) {
          if (isChannelStatus(res.status)) channelError = true;
          reasons.push(`书号 ${isbn} 直达失败（HTTP ${res.status || '连不上'}）`);
          continue;
        }
        const finalUrl = String(res.url || '');
        const sid = (finalUrl.match(/subject\/(\d+)/) || [])[1] || '';
        if (!sid) {
          reasons.push(`书号 ${isbn} 没有跳到条目页（落到 ${finalUrl.slice(0, 60)}）`);
          continue;
        }
        const info = parseInfoLite(res.text);
        if (info.isbn && toIsbn13(info.isbn) !== toIsbn13(isbn)) {
          reasons.push(`书号 ${isbn} 跳到的条目（${sid}）ISBN 是 ${info.isbn}，不是同一版`);
          continue;
        }
        const pic = parseMainPic(res.text);
        if (!pic || isDefaultPic(pic)) {
          reasons.push(`书号 ${isbn} 的条目（${sid}）没有封面（豆瓣用的是默认占位图）`);
          continue;
        }
        found.push({ isbn, sid, pic, info });
      }
      /**
       * 多条都查到时要**挑与所收版本同年**的那一条。
       *
       * 踩过的坑：有的著录里同时写着初版号与所收版号（《十角馆事件》就是——
       * 库里收了 2024 版，而著录里引的是 2004 与 2011 两个号），
       * 若照单从头取第一条，回填的会是**初版封面**——比原来那张更不合所收版本。
       *
       * 所以 `--fix-year-mismatch` 模式下**只认同年那一条**：查不到同年版就什么都不改，
       * 保留原封面（宁可版本不齐，也不要换成另一个不相干的版本）。
       */
      const best =
        found.find((f) => wantYear && String(f.info.year || '').includes(wantYear)) ||
        (args.fixYearMismatch ? null : found[0] || null);
      if (best) {
        picUrl = best.pic;
        matched = 'isbn';
        usedIsbn = best.isbn;
        edition = { title: best.info.title, author: book.author, year: best.info.year };
        sourceUrl = `https://book.douban.com/subject/${best.sid}/`;
      } else if (args.fixYearMismatch && found.length) {
        reasons.push(
          `书号通道查到的版本（${found.map((f) => f.info.year || '年份未标').join('／')}）都与所收版本 ${wantYear || '（年份未标）'} 不同年，保留原封面`,
        );
      }
      if (!picUrl && !isbns.length) reasons.push('著录里没有 ISBN，走不了书号通道');
    }

    if (!picUrl && !reasons.length) reasons.push('检索无候选');
    reason = reasons.join('；');

    let saved = preSaved;
    if (!saved && picUrl && !noChange) {
      await sleep(args.delay);
      saved = await downloadCover(picUrl);
      if (saved?.failed) {
        if (isChannelStatus(saved.status)) channelError = true;
        reason = `图片下载失败（HTTP ${saved.status || '连不上'}）`;
      }
    }

    if (handled) {
      /** 多版本模式里已经登记完毕的：什么都不用再做（`okCount` 已在上面加过） */
    } else if (noChange) {
      /** 版本择优里「已是最合适」的那些：**既不重下、也不记落空**（它们本来就有封面） */
      keptCount += 1;
      if (VERBOSE && (done <= 20 || done % 50 === 0)) {
        console.log(color(`  = ${book.id}《${book.title}》保持原封面：${reason}`, C.dim));
      }
    } else if (saved && !saved.failed) {
      const subject = (sourceUrl.match(/subject\/(\d+)/) || [])[1] || subjectId || '';
      const file = `${book.id}.${saved.ext}`;
      fs.writeFileSync(path.join(COVERS_DIR, file), saved.buf);
      const year = String(edition.year || '').match(/\d{4}/)?.[0] || '';
      const bookYear = String(book.editionYear || '').match(/\d{4}/)?.[0] || '';
      /** 换封面时把**原来那张的出处**留着，台账里能看出「这张是从哪张换过来的」 */
      const prev = index.records[book.id];
      const replacedFrom =
        args.preferNewest && prev
          ? {
              ...(prev.subjectId ? { subjectId: prev.subjectId } : {}),
              year: yearOf(prev.edition?.year),
              matched: prev.matched || '',
            }
          : null;
      index.records[book.id] = {
        file,
        bytes: saved.bytes,
        width: saved.width,
        height: saved.height,
        format: saved.format,
        source: '豆瓣读书',
        sourceUrl,
        subjectId: subject,
        matched,
        ...(usedIsbn ? { isbn: usedIsbn } : {}),
        ...(replacedFrom ? { replacedFrom } : {}),
        query: args.preferNewest
          ? `版本择优（${year || '年份未标'}）`
          : args.source === 'isbn'
            ? `isbn:${usedIsbn || isbnsOf(book)[0] || ''}`
            : args.source === 'weread'
              ? '微信读书检索'
              : sg.query || book.title,
        edition,
        bookYear,
        yearMatch: year && bookYear ? year === bookYear : null,
        fetchedAt: new Date().toISOString(),
      };
      delete index.misses[book.id];
      okCount += 1;
      consecutiveFail = 0;
      if (VERBOSE && (done <= 20 || done % 25 === 0)) {
        console.log(
          `  ✓ ${book.id}《${book.title}》→ ${file} ${saved.width}x${saved.height} ${(saved.bytes / 1024).toFixed(1)}KB ｜ ${matched}${year ? ` ｜ ${year}` : ''}`
        );
      }
    } else {
      skipCount += 1;
      if (channelError) consecutiveFail += 1;
      else consecutiveFail = 0;
      index.misses[book.id] = {
        title: book.title,
        author: book.author,
        reason: reason || '未知',
        triedAt: new Date().toISOString(),
        triedQueries: [book.title],
        ...(channelError ? { channelError: true } : {}),
      };
      // 已经有封面、只是这回没抓到的（例如 `--fix-year-mismatch` 重抓失败）：
      // **不能同时留在 records 与 misses 里**，否则封面闸门会报「既在台账又在未取到清单」。
      if (index.records[book.id]) delete index.misses[book.id];
      missedThisRun.push(`${book.title}｜${reason}`);
      if (VERBOSE && (done <= 20 || done % 25 === 0)) {
        console.log(color(`  · ${book.id}《${book.title}》未取到：${reason}`, C.dim));
      }
    }
  } catch (error) {
    consecutiveFail += 1;
    index.misses[book.id] = {
      title: book.title,
      author: book.author,
      reason: `异常：${error.message}`,
      triedAt: new Date().toISOString(),
    };
    missedThisRun.push(`${book.title}｜异常 ${error.message}`);
  }

  if (args.checkpoint && done % args.checkpoint === 0) {
    saveIndex(index);
    wrote = true;
    console.log(
      color(`  … 进度 ${done}/${targets.length}（命中 ${okCount}／未取到 ${skipCount}，请求 ${requestCount} 次）`, C.dim)
    );
  }

  /** 节流：每 N 部歇一会儿（豆瓣的 HTML 配额是累计的，跑一段歇一段才不会被挡） */
  if (args.pauseEvery && args.pauseMs && done % args.pauseEvery === 0 && done < targets.length) {
    console.log(
      color(`  ⏸ 已处理 ${done} 部，按节流设置休息 ${Math.round(args.pauseMs / 60000)} 分钟（避免触发豆瓣限流）`, C.yellow)
    );
    saveIndex(index);
    wrote = true;
    await sleep(args.pauseMs);
    consecutiveFail = 0;
    consecutiveBlocked = 0;
  }

  /**
   * 熔断：**只对「通道出问题」计数**（网络错、403／418／429／5xx）。
   *
   * 这里踩过一次：第一版把「取不到」一律计数，结果库里的书按批次文件排序，
   * 某一批正好全是豆瓣没有条目的（老译本、地方社通俗推理），
   * 连着十几部落空就触发了熔断——**那 708 部之后的整轮全库跑就是这么停下的**，
   * 而且它长得像「正常跑完」，很容易被当成通道被封。
   * 内容层面的落空（检索无候选／题名不一致／条目没有封面）是**正常结果**，不该熔断。
   */
  if (consecutiveFail >= 8) {
    console.log('');
    console.log(color(`  ✗ 连续 ${consecutiveFail} 部都是通道异常（网络错／被挡／限流），主动熔断退出。`, C.red));
    console.log(color('    已抓到的都在盘上；稍后重跑同一条命令即可增量继续。', C.dim));
    /** 熔断退出前**先落一次盘**：否则最后这一小段下载下来的图会变成「孤儿」 */
    saveIndex(index);
    break;
  }

  /**
   * 豆瓣限流专用熔断：连着一批页面都是那个 3KB 空壳，就别再敲了——
   * 继续跑只会把「取不到版本清单」写成一批「本来就没有其他版本」的结论。
   */
  if (consecutiveBlocked >= 5) {
    console.log('');
    console.log(color(`  ✗ 连续 ${consecutiveBlocked} 部的豆瓣页面都是拦截页，判定为限流，主动收手。`, C.red));
    console.log(color('    已抓到的都在盘上；等一会儿再重跑同一条命令即可增量继续。', C.dim));
    /**
     * 同上：**收手前也要落盘**。第 175 轮就是漏了这一步——
     * 熔断发生在两次 checkpoint 之间，最后几部已下好的图没写进台账，
     * 于是 `check-covers` 报了一串「孤儿图片」（数据没坏，但白跑了几张）。
     */
    saveIndex(index);
    wrote = true;
    break;
  }
  await sleep(args.delay);
}

if (!wrote || args.checkpoint === 0) saveIndex(index);

/** 跑长批次时把「怎么停的」也留个痕：中途异常退出不该只表现为「输出没了」 */
process.on('unhandledRejection', (err) => {
  console.error(color(`  ✗ 未处理的 Promise 异常：${err?.stack || err}`, C.red));
  saveIndex(index);
  process.exit(1);
});

const total = Object.keys(index.records).length;
const missTotal = Object.keys(index.misses).length;
console.log('');
console.log(color(`  ✓ 本轮命中 ${okCount} 部，未取到 ${skipCount} 部${keptCount ? `，保持原封面 ${keptCount} 部` : ''}${addedEditionCount ? `，新增其他版本封面 ${addedEditionCount} 张` : ''}${droppedFiles ? `，判重删掉 ${droppedFiles} 张重复图` : ''}；请求 ${requestCount} 次，用时 ${Math.round((Date.now() - startedAt) / 1000)}s`, C.green));
console.log(`  索引现有封面 ${total} 条，未取到 ${missTotal} 条`);
if (missedThisRun.length) {
  console.log(color('  本轮未取到的前 10 条：', C.dim));
  for (const m of missedThisRun.slice(0, 10)) console.log(color(`    · ${m}`, C.dim));
}
console.log('');
console.log('  下一步：node scripts/gen-cover-manifest.mjs（生成前端清单）');
