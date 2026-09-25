/**
 * 当当书目的抓取与解析（**共享实现**）
 * ==================================
 * 为什么要有这个模块：豆瓣与馆藏两条外源在 2026-09 同时不可用后，当当成了第三条来源。
 * 它的解析现在有两个使用方——`dangdang-lookup.mjs`（按书名速查）与
 * `scan-missing-years.mjs`（批量补出版年）。两边各写一份解析必然漂移，
 * 项目在 `lib/opac.mjs` 与 `lib/dup-rules.mjs` 上已经吃过两次这个亏。
 *
 * ⚠️ 当当**不是**权威编目数据：没有中图法、没有学科主题。
 * 它只能补**简介与出版信息**，**不能替代题材判据**。
 */

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** 当当是 GB2312；Node 自带 full-icu，`TextDecoder('gbk')` 可直接解 */
export async function fetchDecoded(url, { retries = 2 } = {}) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) {
        last = new Error(`HTTP ${res.status}`);
        continue;
      }
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
      return text;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  throw last;
}

export const strip = (s) =>
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

/** 解析检索结果页：每个 `<li id="p<id>">` 里的书名、短简介、作者/出版社行 */
export function parseSearch(text) {
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

/** 从「作者 /2010-02-01 /吉林出版集团」这类行里抽出版日期与出版社 */
export function parseAuthorLine(line) {
  const d = String(line).match(/(\d{4})-(\d{2})-(\d{2})/);
  const pub = String(line).match(/\/\s*([^/]{2,30}?(?:出版社|出版公司|书局|书店|集团|有限责任公司))\s*$/);
  return { date: d ? d[0] : '', year: d ? d[1] : '', publisher: pub ? pub[1] : '' };
}

/** 按书名检索。**当当检索是模糊的**，务必用 exactTitleMatches 过滤，别只看总数 */
export async function search(title) {
  const url = `http://search.dangdang.com/?key=${encodeURIComponent(title)}&act=input`;
  const text = await fetchDecoded(url);
  const rows = parseSearch(text);
  return {
    rows,
    exactTitleMatches: rows.filter((r) => r.title.includes(title)),
  };
}

/** 解析商品详情页 */
export function parseProduct(text) {
  const grab = (label, len = 400) => {
    const i = text.indexOf(label);
    if (i < 0) return '';
    return strip(text.slice(i + label.length, i + label.length + len)).replace(/^[:：]\s*/, '');
  };
  const intro = (() => {
    for (const re of [
      /<div[^>]*class="[^"]*descrip[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /id="content"[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i,
    ]) {
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

export async function product(id) {
  return parseProduct(await fetchDecoded(`http://product.dangdang.com/${id}.html`));
}
