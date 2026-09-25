/**
 * 一次性探针 3：找一条**真正能按作者精确枚举**的编目源
 * ==================================================
 * 第一个馆的 `creatorSearch` 表现不稳定（横沟正史 10/10 精确、宫部美雪 0/10），
 * `creatordef` 直接 0 条。所以换思路：**找有标准作者索引的联合目录／省级馆**。
 *
 * VuFind 系（上海图书馆等）有公开 REST API，`type=Author` 是真正的作者索引，
 * 返回 JSON 且带分面（可含中图法与主题）——正是「按作者收全」需要的东西。
 *
 * 本探针只做连通性与**作者命中率**判断：同一批确定的作者名分别去问，
 * 看返回条目的作者字段是否清一色是本人。
 */
import { SITES, get, parseList } from './lib/uibe.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function head(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
    const text = await res.text();
    return { status: res.status, len: text.length, text, ctype: res.headers.get('content-type') || '' };
  } catch (e) {
    return { status: 0, len: 0, text: '', err: e.message };
  }
}

const TARGETS = [
  ['上图 VuFind API', 'https://vufind.library.sh.cn/api/v1/search?lookfor=%E5%AE%AB%E9%83%A8%E7%BE%8E%E9%9B%AA&type=Author&limit=20'],
  ['上图 VuFind 网页', 'https://vufind.library.sh.cn/Search/Results?lookfor=%E5%AE%AB%E9%83%A8%E7%BE%8E%E9%9B%AA&type=Author'],
  ['国图 Aleph', 'http://opac.nlc.cn/F?func=find-b&find_code=WAU&request=%E5%AE%AB%E9%83%A8%E7%BE%8E%E9%9B%AA'],
  ['浙江图书馆', 'http://opac.zjlib.cn/opac/search?q=%E5%AE%AB%E9%83%A8%E7%BE%8E%E9%9B%AA&searchType=author'],
  ['南京图书馆', 'http://opac.jslib.org.cn/opac/search?q=%E5%AE%AB%E9%83%A8%E7%BE%8E%E9%9B%AA&searchType=author'],
  ['广州图书馆', 'https://opac.gzlib.gov.cn/opac/search?q=%E5%AE%AB%E9%83%A8%E7%BE%8E%E9%9B%AA&searchType=author'],
  ['深圳图书馆', 'https://opac.library.sz.gov.cn/opac/search?q=%E5%AE%AB%E9%83%A8%E7%BE%8E%E9%9B%AA&searchType=author'],
  ['首都图书馆', 'https://opac.clcn.net.cn/opac/search?q=%E5%AE%AB%E9%83%A8%E7%BE%8E%E9%9B%AA&searchType=author'],
  ['天津图书馆', 'http://opac.tjlib.cn/opac/search?q=%E5%AE%AB%E9%83%A8%E7%BE%8E%E9%9B%AA&searchType=author'],
  ['CALIS 联合目录', 'http://opac.calis.edu.cn/simpleSearch.do?TOPMENU=SEARCH&action=simpleSearch&query=%E5%AE%AB%E9%83%A8%E7%BE%8E%E9%9B%AA'],
];

console.log('=== 连通性 ===');
for (const [name, url] of TARGETS) {
  const r = await head(url);
  const looksJson = /json/.test(r.ctype) || /^\s*[{[]/.test(r.text.slice(0, 40));
  console.log(
    `${name.padEnd(16)} status=${String(r.status).padEnd(4)} bytes=${String(r.len).padStart(7)} ${looksJson ? 'JSON' : 'HTML'} ${r.err ? '✗ ' + r.err : ''}`,
  );
  if (r.status === 200 && looksJson) {
    try {
      const j = JSON.parse(r.text);
      const recs = j.records || [];
      console.log(`   ↳ resultCount=${j.resultCount ?? '?'} 返回 ${recs.length} 条`);
      for (const rec of recs.slice(0, 5)) {
        const a = rec.authors?.primary ? Object.values(rec.authors.primary).flat().join(';') : '';
        console.log(`      ${(rec.title || '').slice(0, 34)} ／ ${a.slice(0, 40)}`);
      }
    } catch (e) {
      console.log(`   ↳ JSON 解析失败：${e.message}`);
    }
  }
  await new Promise((res) => setTimeout(res, 400));
}

console.log('\n=== 第一个馆 creatorSearch 翻页：宫部美雪会不会出现在后面几页 ===');
for (let offset = 0; offset <= 50; offset += 10) {
  try {
    const html = await get(
      `${SITES.uibe.base}${SITES.uibe.path}?q=${encodeURIComponent('宫部美雪')}&field=creatorSearch${offset ? `&pager.offset=${offset}` : ''}`,
    );
    const rows = parseList(html);
    const ok = rows.filter((r) => /宫部/.test(r.author || '')).length;
    console.log(`  offset=${String(offset).padStart(3)} 行 ${rows.length} 宫部命中 ${ok}  首行：${rows[0]?.title ?? '（无）'}`);
  } catch (e) {
    console.log(`  offset=${offset} ✗ ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 800));
}
