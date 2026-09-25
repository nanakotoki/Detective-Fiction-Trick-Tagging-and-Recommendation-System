// 一次性：按库内实际数据统计国别/作者/评分，用于同步 README 数字
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = 'data/books';
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  .sort();

const books = [];
for (const f of files) {
  const list = JSON.parse(readFileSync(path.join(DIR, f), 'utf8'));
  for (const b of list) books.push(b);
}

const byCountry = new Map();
for (const b of books) byCountry.set(b.country || '(空)', (byCountry.get(b.country || '(空)') ?? 0) + 1);

const jpAuthors = new Set(books.filter((b) => b.country === '日本').map((b) => b.author));
const allAuthors = new Set(books.map((b) => b.author));
const withRating = books.filter((b) => b.ratings?.douban?.score != null).length;
const withCount = books.filter((b) => b.ratings?.douban?.count != null).length;
const withFp = books.filter((b) => String(b.firstPublished ?? '').trim()).length;
const withEy = books.filter((b) => String(b.editionYear ?? '').trim()).length;
const withAlt = books.filter((b) => Array.isArray(b.alternateTitles) && b.alternateTitles.length).length;

console.log(`作品总数 ${books.length} 部 / 数据文件 ${files.length} 个`);
console.log(`作者总数 ${allAuthors.size} 位`);
console.log(`日本作品 ${byCountry.get('日本') ?? 0} 部（${jpAuthors.size} 位作者）`);
console.log(`中国作品 ${byCountry.get('中国') ?? 0} 部`);
console.log('');
console.log('国别分布：');
for (const [c, n] of [...byCountry.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${c}\t${n}`);
console.log('');
console.log(`豆瓣有分 ${withRating} 部，有评价人数 ${withCount} 部`);
console.log(`firstPublished 非空 ${withFp} 部；editionYear 非空 ${withEy} 部；alternateTitles 非空 ${withAlt} 部`);

const jpCount = new Map();
for (const b of books.filter((x) => x.country === '日本')) jpCount.set(b.author, (jpCount.get(b.author) ?? 0) + 1);
console.log(`收录 ≥ 3 部的日本作者 ${[...jpCount.values()].filter((n) => n >= 3).length} 位`);
const schools = new Set(books.flatMap((b) => b.school ?? []));
console.log(`流派标注覆盖 ${books.filter((b) => (b.school ?? []).length).length} / ${books.length}`);
console.log(`schoolsInUse ${schools.size}`);
