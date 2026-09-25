/**
 * 当当商品详情取证（**共享实现**）
 * ================================
 * 为什么需要它：豆瓣整站 403、馆藏 OPAC 不可达期间，当当是唯一可用的中文外源。
 * 但商品详情页的 HTML **不含**内容简介/编辑推荐——那部分是 AJAX 加载的：
 *   /index.php?r=callback/detail&productId=<id>&templateType=publish&describeMap=&shopId=<n>&categoryPath=...
 * 少一个参数（尤其 categoryPath）就会掉进 404 页，因此这里把 URL 拼装集中一处。
 *
 * ⚠️ 当当只是**销售页文案**：能用来写梗概线索、核对版本与出版社，
 * **不能**当题材判据（见 docs/collection-backlog.md §10 的判据层级）。
 */
import { fetchDecoded, strip, UA } from './dangdang.mjs';

/** 商品页里的书目字段（作者/出版社/出版时间/ISBN），并顺带取出 shopId / categoryPath
 *  —— 专营店的 AJAX 详情必须带对这两个参数，否则返回 404 页而不是内容。 */
export async function productInfo(id) {
  const t = await fetchDecoded(`http://product.dangdang.com/${id}.html`);
  const info = t.match(/messbox_info[\s\S]{0,1600}?<\/div>/);
  const flat = info ? strip(info[0]) : '';
  const author = (flat.match(/作者[:：]([\s\S]*?)出版社/) || [, ''])[1].trim();
  const publisher = (flat.match(/出版社[:：]([\s\S]*?)出版时间/) || [, ''])[1].trim();
  const pubDate = (flat.match(/出版时间[:：]([\s\S]*?)($|条评论|我要写评论)/) || [, ''])[1].trim();
  const isbn = (t.match(/ISBN[：:]\s*([\d\-Xx]{10,20})/) || [, ''])[1];
  const title = strip((t.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [, ''])[1]);
  const store = (t.match(/-\s*当当\s*-\s*([^<]*)<\/title>/) || [, ''])[1];
  const shopId = (t.match(/"shopId"\s*:\s*"(\d+)"/) || [, ''])[1];
  const categoryPath = (t.match(/"categoryPath"\s*:\s*"([\d.]+)"/) || [, ''])[1];
  return {
    id,
    title,
    author,
    publisher,
    pubDate,
    isbn,
    shopId,
    categoryPath,
    store: /当当图书/.test(store) ? '' : store,
  };
}

/**
 * AJAX 详情：返回 { editor, content } 两段文本（各自可能为空）
 * editor = 编辑推荐/产品特色；content = 内容简介
 */
export async function productDetail(id, { shopId = '0', categoryPath = '01.03.38.00.00.00' } = {}) {
  const url =
    `http://product.dangdang.com/index.php?r=callback%2Fdetail&productId=${id}` +
    `&templateType=publish&describeMap=&shopId=${shopId}&categoryPath=${categoryPath}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.text();
  let html = '';
  try {
    const j = JSON.parse(raw);
    html = j?.data?.html || '';
  } catch {
    html = raw;
  }
  // JSON 里的 \uXXXX 已在 JSON.parse 时还原；剩余 HTML 实体交给 strip
  const text = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&ldquo;|&rdquo;/g, '“')
    .replace(/&mdash;/g, '—');
  const clean = (s) =>
    s
      .split('\n')
      .map((l) => l.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');

  const full = clean(text);
  const cut = (label) => {
    const i = full.indexOf(label);
    if (i < 0) return '';
    const rest = full.slice(i + label.length);
    const next = rest.search(/\n(产品特色|编辑推荐|内容简介|目录|作者简介|媒体评论|书摘插画)/);
    return (next > 0 ? rest.slice(0, next) : rest).trim();
  };
  const editor = cut('产品特色') || cut('编辑推荐');
  const content = cut('内容简介');
  return { editor, content, full };
}

export { strip };
