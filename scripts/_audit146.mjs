// 严格口径复核：batch-146 的 40 部里，哪些的**提要本身**就明说了是推理/侦探？
// 「只提到发生了命案」不等于「确定是推理小说」，这一桶必须要求正面表述。
import { readFileSync } from 'node:fs';

const AFFIRMATIVE = /推理|侦探|探案|破案|刑侦|命案|凶手|法医|嫌疑人|谋杀|悬案|罪案|连环杀/;
const STRONG = /推理|侦探|探案|破案|刑侦|悬疑推理|本格/;

const detail = readFileSync('_dd/clc-nosubj-detail.tsv', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
const byTitle = new Map();
for (const r of detail) byTitle.set(r[2], r);

const batch = JSON.parse(readFileSync('data/books/batch-146-clc.json', 'utf8'));
let strong = 0;
let onlyCrime = 0;
let none = 0;
for (const b of batch) {
  // 用原始题名去 detail 表里找（库内题名可能加了副题名分隔）
  const key = [...byTitle.keys()].find((t) => t.startsWith(b.title.slice(0, 6)));
  const r = key ? byTitle.get(key) : null;
  const text = r ? `${r[8]} ${r[9]}` : ''; // 相关题名附注 + 提要
  const tag = STRONG.test(text) ? '强（提要明说是推理/侦探/破案）' : AFFIRMATIVE.test(text) ? '仅犯罪情节' : '无正面表述';
  if (STRONG.test(text)) strong += 1;
  else if (AFFIRMATIVE.test(text)) onlyCrime += 1;
  else none += 1;
  console.log(`[${tag}] ${b.title}  ← ${r ? r[2] : '（未匹配到原始行）'}`);
}
console.log(`\n强 ${strong} / 仅犯罪情节 ${onlyCrime} / 无正面表述 ${none}（共 ${batch.length}）`);
