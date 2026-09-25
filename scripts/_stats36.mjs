import { readFileSync, readdirSync } from 'node:fs';
const books = [];
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  for (const b of j.books || j) books.push(b);
}
const cnt = (arr, key) => {
  const m = new Map();
  for (const b of arr) for (const t of b[key] || []) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const { TAGS } = await import('../web/js/core/tags.js');
const { authorListOf, splitAuthors } = await import('../web/js/core/seed.js');
const name = new Map(TAGS.map((t) => [t.id, t.label]));
console.log('schools:', cnt(books, 'school').map(([k, v]) => `${name.get(k) || k}=${v}`).join(' '));
console.log('multiSchool:', books.filter((b) => (b.school || []).length > 1).length);
console.log('tags 红鲱鱼/多重解答:', cnt(books, 'tags').filter(([k]) => ['red-herring', 'multiple-solutions'].includes(k)).map(([k, v]) => `${name.get(k)}=${v}`).join(' '));
console.log('作者数:', new Set(books.flatMap((b) => authorListOf(b))).size);
console.log('日本作者数:', new Set(books.filter((b) => b.country === '日本').flatMap((b) => authorListOf(b))).size);
const jp = new Map();
for (const b of books.filter((x) => x.country === '日本')) for (const a of authorListOf(b)) jp.set(a, (jp.get(a) || 0) + 1);
console.log('日本≥3部作者:', [...jp.values()].filter((v) => v >= 3).length);
console.log('国别数:', new Set(books.map((b) => b.country)).size);
console.log('alternateTitles 非空:', books.filter((b) => (b.alternateTitles || []).length).length);
console.log('年份: firstPublished 非空', books.filter((b) => b.firstPublished).length, '| editionYear 非空', books.filter((b) => b.editionYear).length);
const rated = books.filter((b) => ['douban', 'hupu', 'goodreads'].some((p) => b.ratings?.[p]?.score != null));
console.log('至少一个平台有分:', rated.length, '/', books.length);
console.log('豆瓣有分:', books.filter((b) => b.ratings?.douban?.score != null).length);
