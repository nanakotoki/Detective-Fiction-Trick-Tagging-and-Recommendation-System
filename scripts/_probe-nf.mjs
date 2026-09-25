/**
 * 一次性探针：`editionYear` 回填里「未找到作者吻合的著录」到底是**馆里没有**还是**检索式的问题**
 *
 * 回填用了 `search(书名)`（题名精确式检索）。536 条未命中里有一批书名带
 * 卷次/副题/丛书前缀（如《日本推理名作选·梦野久作（卷一）》《梅森探案集  逃亡护士  粗心爱神》），
 * 这类串在题名检索里很可能整串匹配不上。
 *
 * 本探针取未命中样本，**剥掉卷次与副题**后重查一次：
 *   · 若剥离后能命中且作者吻合 → 是检索式的问题，值得写第二轮规范化回填；
 *   · 若仍无命中 → 馆里确实没有这一版，`editionYear` 就该留空。
 *
 * 用法：node scripts/_probe-nf.mjs [--limit 12] [--delay 800]
 */
import { readFileSync } from 'node:fs';
import { search } from './lib/uibe.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const limit = Number(arg('--limit', '12'));
const delay = Number(arg('--delay', '800'));

const authorKey = (s) => String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z]/g, '');
const authorMatch = (a, b) => {
  const x = authorKey(a);
  const y = authorKey(b);
  if (!x || !y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && long.includes(short);
};

const rows = readFileSync('_dd/backfill-edition-year.tsv', 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => l.split('\t'))
  .filter((c) => /未找到作者吻合/.test(c[4] || ''));

console.log(`未命中 ${rows.length} 条，取前 ${limit} 条做「剥离卷次后重查」探测\n`);

/** 剥掉卷次、括号副题、长篇副题（「正题  副题  副题」用多空格分隔的情况） */
function simplify(title) {
  return String(title)
    .replace(/[（(【[][^）)】\]]*[）)】\]]/g, '')
    .split(/\s{2,}|·|・|：|:/)[0]
    .trim();
}

let artifact = 0;
for (const c of rows.slice(0, limit)) {
  const [, title, author] = c;
  const s = simplify(title);
  let line = `《${title}》 ${author}`;
  try {
    const res = await search(s, { site: 'uibe' });
    const hits = res.rows.filter((r) => authorMatch(author, r.author));
    if (hits.length) {
      artifact += 1;
      line += `\n    → 简化题名「${s}」命中 ${hits.length} 条：${hits
        .slice(0, 3)
        .map((h) => `${h.title}／${h.author}／${h.publisher}`)
        .join(' | ')}`;
    } else {
      line += `\n    → 简化题名「${s}」仍无作者吻合命中（该馆检索共 ${res.rows.length} 行）`;
    }
  } catch (e) {
    line += `\n    → 检索失败：${e.message}`;
  }
  console.log(line);
  await new Promise((r) => setTimeout(r, delay));
}
console.log(`\n结论预览：${limit} 条里有 ${artifact} 条是「检索式造成的假未命中」。`);
