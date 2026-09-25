import { readFileSync, readdirSync } from 'node:fs';
const books = [];
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  for (const b of j.books || j) books.push(b);
}
for (const w of process.argv.slice(2)) {
  const hit = books.filter((b) => b.title.includes(w) || (b.author || '').includes(w) || (b.originalTitle || '').toLowerCase().includes(w.toLowerCase()));
  console.log(`【${w}】${hit.length} → ${hit.map((b) => `${b.title}(${b.author}${b.originalTitle ? '/' + b.originalTitle : ''})`).join(' ; ') || '无'}`);
}
