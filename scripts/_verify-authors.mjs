import { readFileSync, readdirSync } from 'node:fs';
import { loadSeedBooks, authorListOf } from '../web/js/core/seed.js';
import { tagCooccurrence } from '../web/js/core/engine.js';

const books = loadSeedBooks();
console.log('全库', books.length, '部');

// 1) 有没有「伪作者」——即某个作者名本身含分隔符
const names = new Map();
for (const b of books) for (const n of authorListOf(b)) names.set(n, (names.get(n) ?? 0) + 1);
const pseudo = [...names.keys()].filter((n) => /[、,，;；]/.test(n));
console.log('伪作者（名字里含分隔符）：', pseudo.length ? pseudo.join(' / ') : '0 个 ✓');

// 2) 合著者是否各自计到数
for (const who of ['马伊·舍瓦尔', '佩尔·瓦勒', '豪尔赫·路易斯·博尔赫斯', '阿道夫·比奥伊·卡萨雷斯', '雷蒙德·钱德勒']) {
  console.log(`  ${who} → ${names.get(who) ?? 0} 部`);
}
console.log('作者总数（按署名列表）', names.size, '位');

// 3) 版式：标签与列表是否一致
const bad = books.filter((b) => !b.authors.some((a) => b.author.includes(a)));
console.log('author 标签与 authors 脱节的条目：', bad.length ? bad.map((b) => b.title).join(' / ') : '0 条 ✓');

// 4) 同作者推荐能不能连上（合著 ↔ 独著）
const sw = books.find((b) => b.title === '失踪的消防车');
console.log('《失踪的消防车》authors =', JSON.stringify(sw.authors), '| author =', sw.author);
