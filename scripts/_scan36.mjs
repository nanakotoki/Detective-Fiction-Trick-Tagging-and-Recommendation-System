import { readFileSync, readdirSync } from 'node:fs';
import { TAGS } from '../web/js/core/tags.js';
const schoolIds = new Set(TAGS.filter((t) => t.category === 'school').map((t) => t.id));
const label = new Map(TAGS.map((t) => [t.id, t.label]));
const labelToId = new Map(TAGS.map((t) => [t.label, t.id]));
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const arr = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  for (const b of arr) {
    const bad = (b.school || []).filter((s) => !schoolIds.has(s));
    if (bad.length) console.log(`${f} | ${b.id} | ${b.title} → school 内非法值 ${JSON.stringify(bad)}（应为 ${bad.map((x) => labelToId.get(x) || '?').join(',')} 类别=${bad.map((x) => labelToId.get(x) ? TAGS.find((t) => t.id === labelToId.get(x)).category : '?').join(',')}）`);
    const badTag = (b.tags || []).filter((t) => !TAGS.some((x) => x.id === t));
    if (badTag.length) console.log(`${f} | ${b.id} | ${b.title} → tags 内非法值 ${JSON.stringify(badTag)}`);
  }
}
console.log('扫描完成：school 合法 id 共', schoolIds.size, '个');
