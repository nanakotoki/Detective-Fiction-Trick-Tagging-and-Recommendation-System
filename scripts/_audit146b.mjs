// 严格口径复核（修好题名匹配）：按归一化题名找原始馆藏行
import { readFileSync } from 'node:fs';

const AFFIRMATIVE = /推理|侦探|探案|破案|刑侦|命案|凶手|法医|嫌疑人|谋杀|悬案|罪案|连环杀/;
const STRONG = /推理|侦探|探案|破案|刑侦|本格/;
const norm = (s) => String(s || '').replace(/[\s:：·・,，.。()（）[\]【】\-—_=]/g, '');

const detail = readFileSync('_dd/clc-nosubj-detail.tsv', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
const byTitle = new Map();
for (const r of detail) byTitle.set(norm(r[2]), r);

const batch = JSON.parse(readFileSync('data/books/batch-146-clc.json', 'utf8'));
const missing = [];
let strong = 0;
let onlyCrime = 0;
let none = 0;
for (const b of batch) {
  const n = norm(b.title);
  // 先精确，再前缀（处理「上/下册」「.1」这类分卷后缀）
  let r = byTitle.get(n);
  if (!r) {
    for (const [k, v] of byTitle) {
      if (k.startsWith(n.slice(0, 6)) || n.startsWith(k.slice(0, 6))) {
        r = v;
        break;
      }
    }
  }
  if (!r) {
    missing.push(b.title);
    continue;
  }
  const text = `${r[8]} ${r[9]}`;
  const tag = STRONG.test(text) ? '强' : AFFIRMATIVE.test(text) ? '仅犯罪情节' : '无正面表述';
  if (tag === '强') strong += 1;
  else if (tag === '仅犯罪情节') onlyCrime += 1;
  else none += 1;
  console.log(`[${tag}] ${b.title}`);
  if (tag !== '强') console.log(`      提要：${(r[9] || '（空）').slice(0, 100)}`);
}
console.log(`\n强 ${strong} / 仅犯罪情节 ${onlyCrime} / 无正面表述 ${none} / 未匹配 ${missing.length}（共 ${batch.length}）`);
if (missing.length) console.log('未匹配：', missing.join('、'));
