/**
 * 按作者枚举**上海图书馆**馆藏（`shlib-author-scan`）
 * =================================================
 * **这是第 58 轮之后补上的那条缺失渠道。** 第 58 轮查出第一个馆的
 * `creatorSearch` 是假的（单字 OR 匹配，宫部美雪 60 行 0 命中），
 * 于是「尽量每个作者弄全」这条口径失去了枚举手段。
 *
 * 上图这条经探针验证可用：
 *   · `type=Author` 是**真作者索引**（宫部美雪 54、横沟正史 79、折原一 13、
 *     三津田信三 28，且不混进「折原美都」这类同名片段）；
 *   · 记录带**完整 CNMARC**，题名（200）／责任者（701、702）／出版项（210）／
 *     主题词（606）／**中图法（690）**／丛编（225）／提要（330）／ISBN（010）一次取齐。
 *
 * 拼法回退（本库作者名是历轮固定的写法，未必等于上图规范形式）：
 *   全名 → 末段姓氏（`S·S·范·达因`→`达因`、`帕特里夏·康薇尔`→`康薇尔`）
 *   → 去中点缩写 → 常见异译（克劳夫茨/克罗夫茨/克劳夫兹）。
 *
 * 用法：
 *   node scripts/shlib-author-scan.mjs --db                 # 全库作者（按库内部数降序）
 *   node scripts/shlib-author-scan.mjs --file _dd/a.txt     # 指定名单
 *   node scripts/shlib-author-scan.mjs --authors 折原一,宫部美雪
 * 选项：--out _dd/shlib-author.tsv  --delay 600  --max 200（每位作者最多取回多少条）
 * 断点续跑：已写入 `__DONE__` 的作者自动跳过。
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { scanAuthor } from './lib/shlib.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const OUT = arg('--out', '_dd/shlib-author.tsv');
const DELAY = Number(arg('--delay', '600'));
const MAX = Number(arg('--max', '200'));
const only = (arg('--authors', '') || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);

/** 末段姓氏 / 去中点缩写 / 常见异译 */
const surname = (n) => {
  const segs = String(n).split(/[·.．]/).filter(Boolean);
  return segs.length > 1 ? segs[segs.length - 1] : '';
};
const compact = (n) => String(n).replace(/[·.．\s]/g, '');
const ALTERNATES = {
  弗里曼·威尔斯·克劳夫茨: ['克罗夫茨', '克劳夫兹', '克劳夫特'],
  多萝西·L·塞耶斯: ['塞耶斯', '谢耶斯'],
  'S·S·范·达因': ['范·达因', '凡迪恩', '范迪恩'],
  埃勒里·奎因: ['奎因'],
  约翰·迪克森·卡尔: ['卡尔', '狄克森·卡尔'],
};
function variants(name) {
  const out = [name];
  for (const v of [surname(name), ...(ALTERNATES[name] || []), compact(name)]) {
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

// ── 名单 ────────────────────────────────────────────────────────────
let authors = [];
if (only.length) {
  authors = only;
} else if (argv.includes('--db')) {
  const count = new Map();
  for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
    const arr = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
    if (!Array.isArray(arr)) continue;
    for (const b of arr) {
      for (const n of b.authors?.length ? b.authors : [b.author]) {
        const k = String(n || '').trim();
        if (!k) continue;
        count.set(k, (count.get(k) || 0) + 1);
      }
    }
  }
  authors = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh')).map(([n]) => n);
} else {
  authors = readFileSync(arg('--file', ''), 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
console.log(`待枚举作者 ${authors.length} 位 → ${OUT}（每位最多 ${MAX} 条，间隔 ${DELAY}ms）\n`);

const done = new Set();
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split(/\r?\n/)) {
    const c = line.split('\t');
    if (c[1] === '__DONE__') done.add(c[0]);
  }
} else {
  writeFileSync(OUT, '', 'utf8');
}

let miss = 0;
let hit = 0;
let consecutiveFail = 0;
for (const name of authors) {
  if (done.has(name)) continue;
  let used = '';
  let res = null;
  try {
    for (const v of variants(name)) {
      res = await scanAuthor(v, { max: MAX, delay: DELAY });
      if (res.count > 0) {
        used = v;
        break;
      }
    }
  } catch (e) {
    consecutiveFail += 1;
    console.log(`【${name}】✗ ${e.message}`);
    if (consecutiveFail >= 5) {
      console.log('连续失败 5 次，中止（熔断）');
      break;
    }
    continue;
  }
  consecutiveFail = 0;
  const count = res?.count ?? 0;
  const recs = res?.records ?? [];
  if (count === 0) {
    miss += 1;
    appendFileSync(OUT, `${name}\t__DONE__\t0\t0\t0\t\n`, 'utf8');
    console.log(`【${name}】✗ 上图作者索引无命中`);
    continue;
  }
  hit += 1;
  const seen = new Set();
  let kept = 0;
  for (const r of recs) {
    const key = `${r.title}|${r.year}|${r.isbn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    appendFileSync(
      OUT,
      [
        name, r.title, r.primaryAuthor, r.authors.join('、'), r.clc, r.year,
        (r.publishers || []).join('/'), r.subjects.join(' ; '), (r.series || []).join('/'),
        r.isbn, r.id, used, r.abstract.slice(0, 200),
      ].join('\t') + '\n',
      'utf8',
    );
    kept += 1;
  }
  appendFileSync(OUT, `${name}\t__DONE__\t${count}\t${recs.length}\t${kept}\t${used}\n`, 'utf8');
  console.log(
    `【${name}】✓ 上图著录 ${count} 条，取回 ${recs.length}，入库候选行 ${kept}${used !== name ? `（用「${used}」）` : ''}`,
  );
}
console.log(`\n完成：命中 ${hit} 位、无命中 ${miss} 位；结果 → ${OUT}`);
