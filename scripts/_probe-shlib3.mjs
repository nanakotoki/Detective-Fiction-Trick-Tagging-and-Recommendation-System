/**
 * 探针 6：枚举上图 API 支持的 `field[]` 名称
 * =========================================
 * `field[]=publishers` 有效，说明 VuFind 的 API 可以按需返回字段。
 * 本项目需要的是：**出版项（判 editionYear）**、**主题词（题材判据）**、
 * **中图法分类号（最硬判据）**、ISBN、丛编、提要。
 *
 * 做法：一次请求只带一个字段名，非空即算有效——比猜参数快。
 */
const BASE = 'https://vufind.library.sh.cn';
const ID = '96814dc1-47e7-42f3-8255-8bad01890510';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const CANDIDATES = [
  'title', 'authors', 'formats', 'languages', 'id', 'urls', 'series', 'subjects',
  'publishers', 'publishDate', 'publicationDates', 'classification', 'classifications',
  'callNumbers', 'callNumber', 'isbns', 'isbn', 'edition', 'physicalDescriptions',
  'summary', 'tableOfContents', 'rawData', 'notes', 'generalNotes', 'genre',
  'corporate', 'corporateAuthors', 'secondaryAuthors', 'topics', 'geographic',
  'hierarchy', 'cleanIsbn', 'cleanIsbns', 'recordFormat', 'source', 'onlineAccess',
  'description', 'abstract', 'clc', 'clcNumber', 'subject', 'publisher', 'pubdate',
  'titleStatement', 'responsibility', 'marc', 'fields',
];

async function oneRecord(field) {
  const res = await fetch(`${BASE}/api/v1/record?id=${ID}&field[]=${encodeURIComponent(field)}`, {
    headers: { 'user-agent': UA, accept: 'application/json' },
  });
  if (!res.ok) return { err: `HTTP ${res.status}` };
  const j = JSON.parse(await res.text());
  const rec = j.records?.[0] ?? {};
  const val = rec[field];
  const empty =
    val === undefined || val === null || (Array.isArray(val) && !val.length) || val === '';
  return { keys: Object.keys(rec), empty, val };
}

const ok = [];
for (const f of CANDIDATES) {
  try {
    const r = await oneRecord(f);
    if (r.err) {
      console.log(`  ${f.padEnd(20)} ✗ ${r.err}`);
    } else if (!r.empty) {
      ok.push(f);
      console.log(`  ${f.padEnd(20)} ✓ ${JSON.stringify(r.val).slice(0, 150)}`);
    } else {
      console.log(`  ${f.padEnd(20)} · 空（返回键：${r.keys.join(',')}）`);
    }
  } catch (e) {
    console.log(`  ${f.padEnd(20)} ✗ ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 350));
}
console.log(`\n有效字段 ${ok.length} 个：${ok.join(', ')}`);

console.log('\n=== 组合请求（一次要多字段）===');
const combo = ['title', 'authors', 'publishers', 'publishDate', 'subjects', 'series', 'isbns', 'edition', 'physicalDescriptions', 'summary']
  .map((f) => `field[]=${encodeURIComponent(f)}`)
  .join('&');
const res = await fetch(`${BASE}/api/v1/record?id=${ID}&${combo}`, {
  headers: { 'user-agent': UA, accept: 'application/json' },
});
const j = JSON.parse(await res.text());
console.log(JSON.stringify(j.records?.[0], null, 1).slice(0, 1600));

console.log('\n=== 搜索接口也支持 field[] 吗 ===');
const res2 = await fetch(
  `${BASE}/api/v1/search?lookfor=${encodeURIComponent('宫部美雪')}&type=Author&limit=5&${combo}`,
  { headers: { 'user-agent': UA, accept: 'application/json' } },
);
const j2 = JSON.parse(await res2.text());
console.log(JSON.stringify(j2.records?.[0], null, 1).slice(0, 1200));
