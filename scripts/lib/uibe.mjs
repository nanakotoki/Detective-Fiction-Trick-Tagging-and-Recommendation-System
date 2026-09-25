/**
 * 对外经贸大学图书馆 OPAC（**新的编目数据源**）
 * ============================================
 * 为什么会有这个模块：2026-09 起豆瓣整站 403、原馆藏 OPAC 不可达，
 * 项目**最硬的一类题材判据（中图法 / 学科主题词）一度完全断供**。
 * 2026-09 经网络检索发现对外经贸大学 OPAC（汇文 OPAC v2.2.9）可正常访问，
 * 且检索结果页**逐条带「主题词」分面**、详情页带
 *   丛编项 / 相关题名附注（原题名） / 提要文摘 / 题名主题 / 中图分类
 * ——正好覆盖 `docs/collection-backlog.md` §10 判据层级里的第①类（最硬）。
 *
 * 因此本模块的主要用途是**取证**，不是"多一个来源"：
 *   · `search()`  —— 按题名/作者检索，结果行里就带主题词
 *   · `detail()`  —— 单条完整著录（含原题名与提要）
 *   · `searchAll()` —— 按作者翻页枚举，"把某个作者弄全"直接可用
 *
 * ⚠️ 纪律（血的教训，见 backlog §8）
 *  1. 这是**别人学校的服务器**，不是给我们爬的。默认 800ms 间隔、并发 1。
 *  2. 必须带熔断：连续失败即整体中止。曾因为一次 `--all` 全量扫描
 *     把原 OPAC 打到整站 `fetch failed` 数天，且成果因只在结尾落盘而全丢。
 *  3. 结果行里的「主题词」是**分面截断后的展示**，判定题材请以 `detail()`
 *     的「题名主题」完整字段为准。
 */
import { strip } from './dangdang.mjs';

export const BASE = 'http://opac.lib.uibe.edu.cn';
export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** 每页条数（OPAC 固定 10，翻页用 pager.offset） */
export const PAGE = 10;

/** 熔断器：连续失败到阈值就中止整轮，避免把对方站点打挂 */
export const uibeHealth = {
  fails: 0,
  limit: 6,
  ok() {
    this.fails = 0;
  },
  fail(kind) {
    if (++this.fails >= this.limit) {
      throw new Error(
        `连续 ${this.fails} 次失败（最近：${kind}），已中止——避免重复 2026-09 把馆藏 OPAC 打挂的事故`
      );
    }
  },
  reset() {
    this.fails = 0;
  },
};

export async function get(url, { retries = 2, pause = 800 } = {}) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (!res.ok) {
        last = new Error(`HTTP ${res.status}`);
        uibeHealth.fail(`HTTP ${res.status}`);
      } else {
        const t = await res.text();
        uibeHealth.ok();
        return t;
      }
    } catch (e) {
      last = e;
      uibeHealth.fail(e.message);
    }
    await new Promise((r) => setTimeout(r, pause * (i + 1)));
  }
  throw last;
}

/** 这个 OPAC 用的实体比当当多（&mdash; &hellip; &times; 等），补一层解码 */
export const decodeEntities = (s) =>
  String(s)
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&times;/g, '×')
    .replace(/&sup2;/g, '²')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&middot;/g, '·')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));

/** 「搜索 X 的资源 共有 N 条结果」——注意计数被 `<span><font>` 包着，必须先去标签 */
export function resultCount(html) {
  const m = strip(html).match(/共有\s*([\d,]+)\s*条结果/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/**
 * 解析结果列表：每条含题名/作者/索书号/ISBN/出版信息/主题词/详情链接
 *
 * ⚠️ 这个 OPAC 的 HTML 把属性**折行**了：
 *     <a\n  href="/opac/book/4825…\n"\n  target="_blank">题名</a>
 * 引号与值之间夹着换行，所以任何 `href="…"` 的紧贴式正则会全部落空
 * （第一版就栽在这里，检索"成功"却 0 条）。一律用 `\s*` 容忍折行。
 */
export function parseList(html) {
  const out = [];
  const chunks = html.split(/<li[^>]*>/).filter((c) => c.includes('jp-booksInfo'));
  for (const b of chunks) {
    // 两馆的 bookId 形态不同：对外经贸是 16 位以上十六进制，ctbu（金盘）是 7 位数字
    const idm = b.match(/\/opac\/book\/([0-9a-f]{16,}|\d{4,})/);
    if (!idm) continue;
    // 书名位置也不同：汇文版的 <a> 带 target="_blank"，金盘版把 <h2> 套在 <a> 里
    const titleM =
      b.match(/target="_blank"\s*>\s*([\s\S]*?)<\/a>/) || b.match(/<h2[^>]*>\s*([\s\S]*?)<\/h2>/);
    const grab = (cls) => {
      const m = b.match(new RegExp(`<p class="${cls}"[^>]*>([\\s\\S]*?)</p>`));
      if (!m) return '';
      return strip(m[1].replace(/<strong>[\s\S]*?<\/strong>/, ''));
    };
    const subjects = (b.match(/<p class="subject"[^>]*>([\s\S]*?)<\/p>/) || [, ''])[1];
    out.push({
      bookId: idm[1],
      title: titleM ? decodeEntities(strip(titleM[1].replace(/<img[\s\S]*$/, ''))) : '',
      author: decodeEntities(
        strip(((b.match(/<p class="creator"[^>]*>([\s\S]*?)<\/p>/) || [, ''])[1] || '').replace(
          /<[^>]+>/g,
          ''
        ))
      )
        .replace(/^—\s*/, '')
        .trim(),
      callNumber: grab('call_number'),
      isbn: grab('isbn'),
      publisher: grab('publisher'),
      subjects: subjects
        .replace(/<[^>]+>/g, ' ')
        .split(/[\s\u00a0]+/)
        .map((s) => s.trim())
        .filter((s) => s && s !== '主题词：'),
      sourceId: (b.match(/name="sourceId"[\s\S]{0,20}?value="([^"]*)"/) || [, ''])[1],
    });
  }
  return out;
}

/** 已知的两个可用馆（同族著录，入藏范围互补） */
export const SITES = {
  uibe: { label: '对外经贸大学图书馆', base: 'http://opac.lib.uibe.edu.cn', path: '/opac/search' },
  ctbu: {
    label: '重庆工商大学图书馆',
    base: 'https://libwechat.ctbu.edu.cn',
    path: '/mobile/opac/search',
  },
};

/**
 * 检索。field 常用值：
 *   ''               全部字段
 *   'titleSearch'    题名
 *   'creatorSearch'  著者
 *   'subjectSearch'  主题词
 */
export async function search(q, { field = '', offset = 0, exact = false, pageSize = PAGE, site = 'uibe' } = {}) {
  const s = SITES[site] ?? SITES.uibe;
  const p = new URLSearchParams();
  p.set('q', q);
  if (field) p.set('field', field);
  if (exact) p.set('exactSearch', 'yes');
  if (offset) p.set('pager.offset', String(offset));
  if (pageSize !== PAGE) p.set('pageSize', String(pageSize));
  const html = await get(`${s.base}${s.path}?${p.toString()}`);
  return { rows: parseList(html), count: resultCount(html), html };
}

/** 依次问两个馆，取第一个有精确题名命中的结果 */
export async function searchBoth(q, { field = '', pause = 800 } = {}) {
  const out = [];
  for (const site of Object.keys(SITES)) {
    try {
      const r = await search(q, { field, site });
      out.push({ site, ...r });
    } catch (e) {
      out.push({ site, rows: [], count: null, error: e.message });
    }
    await new Promise((r) => setTimeout(r, pause));
  }
  return out;
}

/** 翻页取完某个检索式的全部结果（带熔断与页数上限） */
export async function searchAll(q, { field = '', max = 300, pause = 800, verbose = false } = {}) {
  const first = await search(q, { field });
  const all = [...first.rows];
  const total = first.count ?? all.length;
  if (verbose) console.log(`  「${q}」共 ${total} 条`);
  let offset = PAGE;
  let empty = 0;
  while (offset < Math.min(total, max)) {
    await new Promise((r) => setTimeout(r, pause));
    let page;
    try {
      page = await search(q, { field, offset });
    } catch (e) {
      console.log(`    offset=${offset} 失败：${e.message}`);
      break;
    }
    if (!page.rows.length) {
      if (++empty >= 2) break;
    } else empty = 0;
    all.push(...page.rows);
    if (verbose) console.log(`    offset=${offset} +${page.rows.length} 累计 ${all.length}`);
    offset += PAGE;
  }
  return { rows: all, count: total };
}

/**
 * 详情页字段：这一版 OPAC 用 `<tr><th>标签：</th><td>值</td></tr>`，
 * **标签在 th 里**（不是 td），所以必须 th/td 配对来取。
 * 「题名主题」会出现多行（推理小说 / 长篇小说 各一行），合并保留。
 */
export function parseDetail(html) {
  const fields = {};
  const re = /<tr>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(html))) {
    const label = decodeEntities(strip(m[1])).replace(/[:：]\s*$/, '').trim();
    const value = decodeEntities(strip(m[2])).replace(/\s+/g, ' ').trim();
    if (!label || !value) continue;
    if (fields[label]) fields[label] += ` ; ${value}`;
    else fields[label] = value;
  }
  return fields;
}

const norm = (k) => k.replace(/\s/g, '');

/** 取单条完整著录，并抽出本项目最关心的几个字段 */
export async function detail(bookId, { site = 'uibe' } = {}) {
  const s = SITES[site] ?? SITES.uibe;
  const prefix = site === 'ctbu' ? '/mobile/opac/book/' : '/opac/book/';
  const html = await get(`${s.base}${prefix}${bookId}`);
  const f = parseDetail(html);
  const pick = (...names) => {
    for (const n of names) {
      for (const [k, v] of Object.entries(f)) if (norm(k).startsWith(norm(n))) return v;
    }
    return '';
  };
  return {
    raw: f,
    isbn: pick('ISBN'),
    titleAuthor: pick('题名责任者项', '题名责任者'),
    imprint: pick('出版发行项'),
    series: pick('丛编项'),
    titleNote: pick('相关题名附注'),
    abstract: pick('提要文摘'),
    /** 学科主题词——判据层级第①类 */
    subjects: pick('题名主题'),
    clc: pick('中图分类'),
    callNumber: pick('索书号'),
    author: pick('个人名称等同'),
  };
}

/** 把详情里的「题名主题」判成推理与否（与旧 opac 的 clcVerdict 同义） */
export function subjectVerdict(subjects) {
  const s = String(subjects);
  if (/推理小说|侦探小说/.test(s)) return { mystery: true, why: '学科主题含「推理小说/侦探小说」' };
  return { mystery: false, why: s ? `学科主题为「${s}」，未见推理/侦探` : '无学科主题字段' };
}
