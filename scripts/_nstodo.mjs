import { readFileSync, writeFileSync } from 'node:fs';
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

// 已明确排除的（每条都在 backlog 里记过理由），不再出现在待办里
const EXCLUDED = [
  // 盗墓／灵异／精怪／萨满
  '苗疆道事', '搜山记', '三铜', '绝对循环', '天坑鹰猎', '世界', '七根凶简', '三线轮洄',
  '西海通天塔之地眼天坑', '天地萨满', '乌妮格家族', '神秘事件调查员真实口述', '腥', '麻',
  '诅咒', '旋转门', '红楼密码', '返祖', // 返祖 已收，此行仅占位防误判
  // 文学/科幻/非推理
  '香水', '巧克力时代', '神木', '寻死无门', '巴人密码', '江南役', '玉琮迷踪', '四十岁男人的困惑',
  // 选集内容已在库
  '福尔摩斯探案集', '福尔摩斯探案全集', '冒险史', '福尔摩斯探案精品集', 'THE COMPLETE CLASSIC SERIES OF SHERLOCK HOLMES',
  '布朗神父探案全集',
  // 纯间谍／谍战
  '风筝', '枪与玫瑰', '雁城谍影',
].map(norm);

const rows = readFileSync('_dd/clc-nosubj-detail.tsv', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
const todo = [];
for (const r of rows) {
  const [clc, bookId, title, author, imprint, clcCode, subjects, series, titleNote, abstract] = r;
  const n = norm(title);
  if (db.has(n)) continue;
  if (EXCLUDED.some((e) => e && (n.startsWith(e) || e.startsWith(n.slice(0, 6))))) continue;
  todo.push({ clc, title, author, imprint, series, abstract: (abstract || '').replace(/\s+/g, ' ') });
}
writeFileSync(
  '_dd/nosubj-todo.txt',
  todo.map((t) => [t.clc, t.title, t.author, t.imprint, t.series, t.abstract].join('\t')).join('\n') + '\n',
  'utf8',
);
console.log(`无主题词桶：候选 ${rows.length} 条 → **待处理 ${todo.length} 条**（已入库/已排除 ${rows.length - todo.length} 条）\n`);
todo.forEach((t, i) => {
  console.log(`${String(i + 1).padStart(3)}. [${t.clc}] ${t.title} | ${t.author || '（无著者）'} | ${t.imprint} | 丛编:${t.series || '-'}`);
  if (t.abstract) console.log(`      ${t.abstract.slice(0, 105)}`);
});
