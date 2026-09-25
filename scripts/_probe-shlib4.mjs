/**
 * 探针 7：搜索接口能否**批量**带回 MARC（rawData）
 * ==============================================
 * 单条记录要 `field[]=rawData` 能取到 `fullrecord`（CNMARC 全文）。
 * 如果**搜索接口**也能一次带回整页的 rawData，那么「按作者枚举 + 判据取证」就
 * 合成一步：一次请求 = 该作者 20 部作品的题名／出版项／主题词／中图法。
 *
 * 本探针打印 MARC 原文，确认里面确实有 606（主题）与 690（中图法）。
 */
const BASE = 'https://vufind.library.sh.cn';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const FIELDS = ['title', 'authors', 'publishers', 'publicationDates', 'subjects', 'series', 'isbns', 'rawData'];
const qs = FIELDS.map((f) => `field[]=${encodeURIComponent(f)}`).join('&');

const res = await fetch(
  `${BASE}/api/v1/search?lookfor=${encodeURIComponent('折原一')}&type=Author&limit=20&${qs}`,
  { headers: { 'user-agent': UA, accept: 'application/json' } },
);
const j = JSON.parse(await res.text());
console.log(`resultCount=${j.resultCount} 返回 ${j.records.length} 条`);
console.log('第一条的键：', Object.keys(j.records[0]).join(', '));

for (const r of j.records.slice(0, 2)) {
  console.log(`\n===== ${r.title} =====`);
  const marc = r.rawData?.fullrecord || '';
  console.log(`fullrecord 长度 ${marc.length}`);
  console.log(marc.slice(0, 1500));
}

console.log('\n=== MARC 里有没有 606 / 690 ===');
for (const r of j.records.slice(0, 5)) {
  const marc = r.rawData?.fullrecord || '';
  const has = (tag) => new RegExp(`(^|[^0-9])${tag}`).test(marc);
  const subjects = [...marc.matchAll(/606[^]{0,80}/g)].map((m) => m[0].replace(/\s+/g, ' ')).slice(0, 2);
  const clc = [...marc.matchAll(/690[^]{0,40}/g)].map((m) => m[0].replace(/\s+/g, ' ')).slice(0, 2);
  console.log(
    `${(r.title || '').slice(0, 20).padEnd(22)} 606=${has('606') ? subjects.join(' | ') : '无'}   690=${has('690') ? clc.join(' | ') : '无'}`,
  );
}
