import { readFileSync } from 'node:fs';
import { loadSeedBooks } from '../web/js/core/seed.js';

const books = loadSeedBooks();
const norm = (s) =>
  String(s)
    .replace(/[\s:：·・,，.。()（）[\]【】\-—_=]/g, '')
    .replace(/第[一二三四五六七八九十\d]+[部卷册季]/g, '')
    .toLowerCase();
const db = new Map();
for (const b of books) {
  db.set(norm(b.title), b);
  for (const a of b.alternateTitles || []) db.set(norm(a), b);
}
// 已明确排除的（记录过理由），不再重复出现在待办里
const EXCLUDED = new Set(
  [
    '法医之书', '宽恕之城', '法医秦明,幸存者', '别在东京哭泣', '龙眼石之谜:精华本',
    '柏林谍影', '二蓝神事务所.上', '二蓝神事务所.下', '推理', '侠盗亚森·罗平:全彩插图版',
    '博莱特·法拉1', '排队的人4', '歌唱的沙3', '时间的女儿6', '法兰柴思事件2',
    '萍小姐的主意5', '一张俊美的脸8', '一先令蜡烛7', '神探伽利略.7,虚像小丑',
    '折断的龙骨.上', '折断的龙骨.下', '烟囱宅之谜', '煦阳岭疑云', '致命遗产',
    '清明上河图密码:隐藏在千古名画中的阴谋与杀局.2',
  ].map(norm),
);

const rows = readFileSync('_dd/clc-hard.txt', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
const todo = [];
for (const [clc, title, author, callNumber, publisher, isbn, subjects, bookId] of rows) {
  const n = norm(title);
  if (db.has(n) || EXCLUDED.has(n)) continue;
  todo.push({ clc, title, author, publisher, callNumber });
}
console.log(`硬判据候选 ${rows.length} 条，其中库内已有或已排除 ${rows.length - todo.length} 条，**待处理 ${todo.length} 条**\n`);
todo.forEach((t, i) => console.log(`${String(i + 1).padStart(3)}. [${t.clc}] ${t.title} | ${t.author} | ${t.publisher} | ${t.callNumber}`));
