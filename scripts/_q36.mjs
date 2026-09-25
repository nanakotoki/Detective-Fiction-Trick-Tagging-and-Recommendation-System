import { readdirSync, readFileSync, statSync } from 'node:fs';
const dir = 'data/books';
const books = [];
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && statSync(`${dir}/${f}`).isFile());
for (const f of files) {
  const j = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  for (const b of j.books || j) books.push({ ...b, _f: f });
}
console.log('批次数', files.length, '总书数', books.length);
const multi = books.filter((b) => /、|，| 等|等$|主编/.test(b.author || ''));
console.log('\n== 多作者/合著样态:', multi.length);
console.log(multi.map((b) => `${b.author} | ${b.title} | ${b._f}`).join('\n'));
console.log('\n== 克里斯蒂');
console.log(books.filter((b) => /克里斯蒂|克莉丝蒂|Christie/i.test(b.author || '')).map((b) => `${b.title} [${b.originalTitle || ''}] ${b.author} alt=${(b.alternateTitles || []).join('/')}`).join('\n'));
console.log('\n== 卢布朗/亚森');
console.log(books.filter((b) => /卢布朗/.test(b.author || '') || /亚森/.test(b.title)).map((b) => `${b.title} | ${b.author} | ${b._f}`).join('\n'));
console.log('\n== 福尔摩斯续集/仿作');
console.log(books.filter((b) => /福尔摩斯/.test(b.title)).map((b) => `${b.title} | ${b.author}`).join('\n'));
