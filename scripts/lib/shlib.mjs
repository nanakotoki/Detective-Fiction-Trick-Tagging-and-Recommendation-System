/**
 * 上海图书馆 VuFind 客户端（**含 CNMARC 解析**）
 * ============================================
 * **为什么又开一个馆**：第 58 轮查出第一个馆的「按作者枚举」是假的
 * （`creatorSearch` 退化成单字 OR 匹配，宫部美雪 60 行里 0 行命中），
 * 于是「每个作者弄全」这条口径失去了渠道。上图这条是新找到的、**真正可用**的一条：
 *
 *   1. `https://vufind.library.sh.cn/api/v1/search?lookfor=<作者>&type=Author`
 *      —— `type=Author` 是**真正的作者索引**（宫部美雪 54 部、横沟正史 79 部、
 *      折原一 13 部、三津田信三 28 部，且不混进「折原美都」这类同名片段）。
 *   2. 记录里带 `rawData.fullrecord` —— **完整 CNMARC**（0x1E 分字段、0x1F 分子字段），
 *      于是题名（200）、责任者（100/701/702）、出版项（210）、主题词（606）、
 *      **中图法分类号（690）**、丛编（225）、提要（330）、ISBN（010）一次取齐。
 *      这正是本项目「题材判据 + 版本年」需要的全部字段。
 *   3. 单页上限 **20 条**（`limit=100` 仍回 20，`limit=300` 报 400），故按 `page` 翻页。
 *
 * ⚠️ 仍是别人家的服务器：默认 600ms 间隔、并发 1。
 */

export const BASE = 'https://vufind.library.sh.cn';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** 需要 API 返回的字段（`field[]` 可多次出现；实测有效的字段名见 §59） */
export const FIELDS = [
  'title',
  'authors',
  'publishers',
  'publicationDates',
  'subjects',
  'series',
  'isbns',
  'rawData',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 单页上限（实测 100 与 300 都不行：前者仍回 20，后者 400） */
export const PAGE_SIZE = 20;

async function apiJSON(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'user-agent': UA, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * 解析 CNMARC 全文。
 *
 * 结构：`leader(24) + 目次区(每条 12 字符：标签3+长度4+偏移5) + 0x1E + 各字段(以 0x1E 结尾)`。
 * 字段数据开头是**两个指示符字符**，之后以 0x1F 分隔子字段（每个子字段首字符是子字段代码）。
 *
 * ⚠️ 不要用「标签出现在正文里」去找字段——标签只在目次区出现，
 * 正文里的 "606" 之类是数字巧合（本轮踩过）。
 */
export function parseMarc(fullrecord) {
  const raw = String(fullrecord || '');
  if (!raw) return { leader: '', fields: [] };
  const leader = raw.slice(0, 24);
  const firstSep = raw.indexOf('\u001e');
  if (firstSep < 0) return { leader, fields: [] };
  const directory = raw.slice(24, firstSep);
  const entries = [];
  for (let i = 0; i + 12 <= directory.length; i += 12) {
    const chunk = directory.slice(i, i + 12);
    if (!/^\d{3}/.test(chunk)) break;
    entries.push({
      tag: chunk.slice(0, 3),
      length: Number(chunk.slice(3, 7)),
      offset: Number(chunk.slice(7, 12)),
    });
  }
  const body = raw.slice(firstSep + 1);
  const chunks = body.split('\u001e').filter((s, i, a) => i < a.length - 1 || s.length);
  const fields = entries.map((e, i) => {
    const text = chunks[i] ?? '';
    const indicators = text.slice(0, 2);
    const sub = {};
    for (const part of text.slice(2).split('\u001f')) {
      if (!part) continue;
      const code = part[0];
      const value = part.slice(1).trim();
      if (!value) continue;
      (sub[code] ||= []).push(value);
    }
    return { tag: e.tag, indicators, sub };
  });
  return { leader, fields };
}

/** 取某标签下某子字段的全部取值 */
export const subValues = (parsed, tag, code) =>
  parsed.fields.filter((f) => f.tag === tag).flatMap((f) => f.sub[code] || []);

/** 中图法分类号（690 $a；有的馆用 905，这里一并兜住） */
export function clcOf(parsed) {
  const a = subValues(parsed, '690', 'a');
  if (a.length) return a[0];
  return '';
}

/** 学科主题词（606 $a/$x/$y/$z 拼起来，与第一个馆的「主题词」同义） */
export function subjectsOf(parsed) {
  return parsed.fields
    .filter((f) => f.tag === '606')
    .map((f) => ['a', 'x', 'y', 'z'].flatMap((c) => f.sub[c] || []).join(' '))
    .filter(Boolean);
}

/** 出版发行项（210 $a 出版地 / $c 出版者 / $d 出版年） */
export function imprintOf(parsed) {
  const f = parsed.fields.find((x) => x.tag === '210');
  if (!f) return '';
  const place = (f.sub.a || []).join(' ');
  const pub = (f.sub.c || []).join(' ');
  const year = (f.sub.d || []).join(' ');
  return [place, pub, year].filter(Boolean).join(' ').trim();
}

/** 题名与责任者（200 $a 正题名 / $f 责任者） */
export function titleStatementOf(parsed) {
  const f = parsed.fields.find((x) => x.tag === '200');
  if (!f) return { title: '', responsibility: '' };
  return {
    title: (f.sub.a || []).join(''),
    responsibility: (f.sub.f || []).join(' '),
  };
}

/**
 * 主要责任者。
 *
 * ⚠️ **CNMARC 里 100 是「通用处理数据」**（`20110623d2011    em y0chiy0110    ea` 那一串），
 * **个人著者在 701**、次要责任者（译者等）在 702。第一版按 MARC21 的习惯写成 100，
 * 结果把 008 那一串日期当成了作者名——探针打印出来才发现。
 */
export function primaryAuthorOf(parsed) {
  const alt = subValues(parsed, '701', 'a');
  if (alt.length) return alt[0];
  const direct = subValues(parsed, '711', 'a');
  return direct.length ? direct[0] : '';
}

/** 全部责任者（701 个人主要责任者 / 702 次要责任者 / 711、712 团体，去重保序） */
export function allAuthorsOf(parsed) {
  const out = [];
  for (const tag of ['701', '702', '711', '712']) {
    for (const f of parsed.fields.filter((x) => x.tag === tag)) {
      const v = (f.sub.a || [])[0];
      if (v && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

/** 丛编项（225 $a） */
export const seriesOf = (parsed) => subValues(parsed, '225', 'a');

/** 提要（330 $a） */
export const abstractOf = (parsed) => subValues(parsed, '330', 'a').join(' ').trim();

/** ISBN（010 $a） */
export const isbnOf = (parsed) => subValues(parsed, '010', 'a');

/** 把一条 API 记录整理成本项目惯用的扁平结构 */
export function normalizeRecord(rec) {
  const parsed = parseMarc(rec.rawData?.fullrecord);
  const ts = titleStatementOf(parsed);
  const primary = Object.keys(rec.authors?.primary || {});
  return {
    id: rec.id,
    title: rec.title || ts.title,
    responsibility: ts.responsibility,
    // API 的作者字段带「(日) 」这类国别前缀，MARC 的 100/701 更干净
    primaryAuthor: primaryAuthorOf(parsed) || primary[0] || '',
    authors: allAuthorsOf(parsed),
    translators: subValues(parsed, '702', 'a'),
    subjects: subjectsOf(parsed).length ? subjectsOf(parsed) : (rec.subjects || []).map((s) => s.join(' ')),
    clc: clcOf(parsed),
    imprint: imprintOf(parsed),
    year: (subValues(parsed, '210', 'd')[0] || (rec.publicationDates || [])[0] || '').replace(/[^0-9]/g, '').slice(0, 4),
    publishers: rec.publishers || [],
    series: seriesOf(parsed).length ? seriesOf(parsed) : rec.series || [],
    isbn: (isbnOf(parsed)[0] || (rec.isbns || [])[0] || '').trim(),
    abstract: abstractOf(parsed),
    /** 语种（101 $a 更可靠；API 的 languages 常只有 Chinese/Japanese 这类粗值） */
    languages: rec.languages || [],
  };
}

/**
 * 按作者检索一页。
 * @param {string} name 作者名（中文即可，不必带「(日) 」前缀）
 * @param {{page?:number}} opts
 */
export async function searchAuthorPage(name, { page = 1 } = {}) {
  const qs = [
    `lookfor=${encodeURIComponent(name)}`,
    'type=Author',
    `limit=${PAGE_SIZE}`,
    `page=${page}`,
    ...FIELDS.map((f) => `field[]=${encodeURIComponent(f)}`),
  ].join('&');
  const j = await apiJSON(`/api/v1/search?${qs}`);
  return { count: j.resultCount ?? 0, records: (j.records || []).map(normalizeRecord) };
}

/**
 * 按**丛编**检索一页（第 122 轮新开的渠道）。
 *
 * 为什么需要它：候选池是按**作者**枚举出来的（`type=Author`，§59），到第 121 轮已经见底
 * （尚余 240 条、最大一组只有 4 条）。而出版丛书是另一条正交的轴——
 * 「午夜文库」「日本推理小说文库」「大唐狄公案」这类**推理专门丛书**的卷次是有限集合，
 * 逐卷对库就能看出缺口，而且**不限于库里已有的作者**。
 *
 * 探针结论（§122.1，`_dd/_probe-series122.mjs`）：
 *   · `type=Series` **可用**（「午夜文库」命中 1120 条）；
 *   · `type=Title` 拿丛编名当题名查 → 0 条（丛编不在题名索引里）；
 *   · `filter[]=series:"…"` 同样可用（1119 条），与前者等价；
 *   · `type=adv` / `type=AllFields` / `type=CallNumber` 都返回 0（不支持）。
 */
export async function searchSeriesPage(name, { page = 1 } = {}) {
  const qs = [
    `lookfor=${encodeURIComponent(name)}`,
    'type=Series',
    `limit=${PAGE_SIZE}`,
    `page=${page}`,
    ...FIELDS.map((f) => `field[]=${encodeURIComponent(f)}`),
  ].join('&');
  const j = await apiJSON(`/api/v1/search?${qs}`);
  return { count: j.resultCount ?? 0, records: (j.records || []).map(normalizeRecord) };
}

/**
 * 枚举某位作者的全部作品（自动翻页）。
 * @param {string} name
 * @param {{max?:number, delay?:number, onPage?:(info:object)=>void}} opts
 */
export async function scanAuthor(name, { max = 200, delay = 600, onPage } = {}) {
  const out = [];
  let count = 0;
  for (let page = 1; out.length < max; page += 1) {
    if (page > 1) await sleep(delay);
    const r = await searchAuthorPage(name, { page });
    if (page === 1) count = r.count;
    if (!r.records.length) break;
    out.push(...r.records);
    onPage?.({ page, got: r.records.length, total: out.length, count });
    if (r.records.length < PAGE_SIZE) break;
    if (page * PAGE_SIZE >= count) break;
  }
  return { name, count, records: out.slice(0, max) };
}

/**
 * 枚举某个丛编的全部馆藏（自动翻页）。与 `scanAuthor` 同一套分页与节流规则。
 * @param {string} name 丛编名（可以只写主干，「午夜文库」会连「午夜文库. 原创系列」一起命中）
 * @param {{max?:number, delay?:number, onPage?:(info:object)=>void}} opts
 */
export async function scanSeries(name, { max = 200, delay = 600, onPage } = {}) {
  const out = [];
  let count = 0;
  for (let page = 1; out.length < max; page += 1) {
    if (page > 1) await sleep(delay);
    const r = await searchSeriesPage(name, { page });
    if (page === 1) count = r.count;
    if (!r.records.length) break;
    out.push(...r.records);
    onPage?.({ page, got: r.records.length, total: out.length, count });
    if (r.records.length < PAGE_SIZE) break;
    if (page * PAGE_SIZE >= count) break;
  }
  return { name, count, records: out.slice(0, max) };
}
