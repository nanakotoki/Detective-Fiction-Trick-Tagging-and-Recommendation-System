// 一次性：修正 batch-138 的四项体检错误
import { readFileSync, writeFileSync } from 'node:fs';
const p = 'data/books/batch-138-opac10.json';
const t = readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const arr = JSON.parse(t);
const fixes = [
  ['facet138-006', '"tags": ["forensic", "concealment", "fear", "race-against-time"]', '"tags": ["forensic", "concealment", "fear", "silencing"]'],
  ['facet138-016', '死亡名单上最后一个人的名字到底是谁。', '而死亡名单上那个尚未出现的名字，成了她必须弄清的事。'],
  ['facet138-021', '"tags": ["police-procedural", "series-detective", "bizarre", "concealment"]', '"tags": ["series-detective", "concealment", "dark-atmosphere", "fear"]'],
  ['facet138-029', '百口莫辩之时，又被警方当作杀害一名女警官的嫌疑人。', '百口莫辩之时，她又因一名女警官遇害而被警方列为嫌疑人。'],
];
for (const [id, from, to] of fixes) {
  const b = arr.find((x) => x.id === id);
  if (!b) { console.log(`✗ 找不到 ${id}`); continue; }
  if (from.startsWith('"tags"')) {
    b.tags = JSON.parse(to.slice(to.indexOf('[')));
    console.log(`✓ ${id} tags → ${b.tags.join(', ')}`);
  } else if (b.safeSummary.includes(from)) {
    b.safeSummary = b.safeSummary.replace(from, to);
    console.log(`✓ ${id} 简介已改写`);
  } else {
    console.log(`✗ ${id} 未匹配到待改文本`);
  }
}
writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf8');
console.log('已写回', arr.length, '条');
