/**
 * 上图缺口的**分层筛**（`shlib-triage`）
 * ================================
 * `shlib-diff.mjs` 报出 2264 条「硬判据缺口」，但**硬判据只说明它是推理小说，
 * 不说明它该进这个库**。抽样一看就明白，里面混着五类东西：
 *
 *   1. **套装分卷**：《福尔摩斯探案大全集》的「归来记 一/二/三」、《大唐狄公案 陆 迷宫案》……
 *      ——母本在库里已有，分卷收进来就是同一批内容两个条目（§58.5 已按此口径挡过 7 条）。
 *   2. **少儿版**：CLC `I313.84`／主题词带「儿童小说」、少年儿童出版社的少年侦探团。
 *   3. **语言读物**：`H319.4:I561.45`、`H369.4` 这类双语／学习版。
 *   4. **评论与写作教程**：`I054 推理小说 小说创作 创作方法` 之类，**不是小说**。
 *   5. **真正的全新作品**：如乱步《暗室》《盲兽》《人豹》——这才是要收的。
 *
 * 本工具按这五类分层，输出：
 *   · `*_new.tsv`     —— **全新作品**（唯一题名、非套装、非少儿/读物/评论）
 *   · `*_set.tsv`     —— 套装分卷（母本不在库）
 *   · `*_drop.tsv`    —— 已挡掉（含每条的理由）
 *
 * 用法：node scripts/shlib-triage.mjs [--in _dd/shlib-gap.tsv] [--prefix _dd/shlib]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { normText } from './lib/dup-rules.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const IN = arg('--in', '_dd/shlib-gap.tsv');
const PREFIX = arg('--prefix', '_dd/shlib');

// ── 知识库题名（含异名）与系列 ──────────────────────────────────────
const dbTitles = new Set();
const dbSeries = new Set();
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  const arr = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  if (!Array.isArray(arr)) continue;
  for (const b of arr) {
    dbTitles.add(normText(b.title));
    for (const a of b.alternateTitles || []) dbTitles.add(normText(a));
    if (b.series && b.series !== '非系列') dbSeries.add(normText(b.series));
  }
}

/** 分卷标记：结尾的「一/二/三/上/中/下/数字/第N卷」 */
const VOLUME_TAIL =
  /(?:第?[一二三四五六七八九十百零\d]+[卷册部集篇]?|[（(][一二三四五六七八九十\d]+[）)]|上|中|下|续|新)+$/;
function baseTitle(t) {
  let s = String(t || '').trim();
  // 「大唐狄公案 陆 迷宫案」这类：去掉中间的卷次标记
  s = s.replace(/\s*[第]?[一二三四五六七八九十百零\d]+\s*[卷册]\s*/g, ' ');
  let prev;
  do {
    prev = s;
    s = s.replace(VOLUME_TAIL, '').trim();
  } while (s !== prev && s.length > 2);
  return s || String(t || '').trim();
}

const SUBJ_MYSTERY = /推理小说|侦探小说/;

/**
 * 题名的**变体键**：同一个中文书名常有多种写法，只比原样会漏。
 *   ① 去「的」（《巴斯克维尔猎犬》↔《巴斯克维尔的猎犬》——本轮真实踩到）；
 *   ② 取空格／间隔号切分后的**末段**（《大唐狄公案 陆 迷宫案》→《迷宫案》，
 *      库内已单卷收录，属套装分卷）；
 *   ③ 去掉套装词后再比（《福尔摩斯探案全集 冒险史》→《冒险史》）。
 */
const SET_WORDS = /(全集|大全集|文集|作品集|选集|精选集|精选|合集|读本|套装|系列|典藏|珍藏|插图版|插画版|注释版|导读版|新版|修订版|第\d+版)/g;
/**
 * 第 65 轮补的两条规则（都是被真实漏网案例逼出来的）：
 *   ① **系列前缀**：库内《首席女法医：波特墓园》，候选是「波特墓园」——
 *      上一版只去套装词，抓不到带冒号的系列前缀，于是 6 条同书异名全部漏过；
 *   ② **「谜案／奇案／案」后缀等价**：库内《铜钟案》，候选「铜钟谜案」；
 *      库内《漆屏案》，候选「漆画屏风奇案」——后缀不同、字数差一位，
 *      包含判定（要求短边 ≥4 字）也拦不住。
 */
const SERIES_PREFIX = /^[^：:]{2,12}[：:]/;
/**
 * 案件类后缀的**等价族**。
 *
 * 第 66 轮又踩到一次：库内《东北新干线**杀人事件**》／候选「东北新干线**谋杀案**」、
 * 库内《终点站**杀人事件**》／候选「终点站**谋杀案**」——
 * 同一部作品的两个中译名，后缀一个是「杀人事件」一个是「谋杀案」，
 * 而上一版只把「谜案／奇案／疑案／案」当作等价后缀，抓不到这一族。
 */
const CASE_SUFFIX = /(杀人事件|谋杀案|凶杀案|杀人案|命案|惨案|谜案|奇案|疑案|案)$/;
/** 案件词族之间的互相替换（用于生成等价变体键） */
const CASE_WORDS = ['杀人事件', '谋杀案', '凶杀案', '杀人案', '命案', '惨案', '谜案', '奇案', '疑案', '案'];
function variantKeys(title) {
  const out = new Set();
  const raw = String(title || '').trim();
  const add = (s) => {
    const n = normText(s);
    if (n) out.add(n);
  };
  const stripAll = (s) => {
    let prev;
    let cur = s;
    do {
      prev = cur;
      cur = cur.replace(SET_WORDS, '');
    } while (cur !== prev);
    return cur;
  };
  const push = (s) => {
    add(s);
    add(s.replace(/[的之]/g, ''));
    const noCase = s.replace(CASE_SUFFIX, '');
    add(noCase);
    add(`${noCase}案`);
    // 后缀词族的**互相替换**：杀人事件 ↔ 谋杀案 ↔ 奇案 …
    for (const w of CASE_WORDS) add(`${noCase}${w}`);
    add(noCase.replace(/[的之]/g, ''));
    const noPrefix = s.replace(SERIES_PREFIX, '');
    if (noPrefix !== s) {
      add(noPrefix);
      add(noPrefix.replace(/[的之]/g, ''));
      const npNoCase = noPrefix.replace(CASE_SUFFIX, '');
      add(npNoCase);
      add(`${npNoCase}案`);
      for (const w of CASE_WORDS) add(`${npNoCase}${w}`);
    }
  };
  push(raw);
  push(stripAll(raw));
  const segs = raw.split(/[\s·・:：,，、/]+/).filter(Boolean);
  if (segs.length > 1) {
    add(segs[segs.length - 1]);
    add(segs.slice(1).join(''));
  }
  for (const s of stripAll(raw).split(/[\s·・:：,，、/]+/).filter(Boolean)) add(s);
  return [...out];
}
/** 某个变体键是否已在库（含「库内题名包含它」这种选集/全集/带系列前缀的情形） */
function inDb(key) {
  if (!key) return false;
  if (dbTitles.has(key)) return true;
  if (key.length >= 4) {
    for (const t of dbTitles) if (t.length >= 4 && (t.includes(key) || key.includes(t))) return true;
  }
  return false;
}
/**
 * 候选自身的题名也要走「包含」判定。
 *
 * 踩过的坑：库内是《首席女法医：波特墓园》，候选是「波特墓园」——
 * 前缀在**库内一侧**，而上一版只对「变体键」做包含判定、把自身题名排除在外，
 * 于是 6 条同书异名全部漏过（`shlib-new.tsv` 里混着已入库的书）。
 */
const inDbIncludingSelf = (ownKey) => (ownKey.length >= 4 ? inDb(ownKey) : dbTitles.has(ownKey));
const DROP_RULES = [
  { why: '少儿版', test: (g) => /儿童小说|儿童文学|少年儿童|少儿/.test(g.subjects + g.publisher + g.series) || /^I(18|28[78]|3\d\d\.8)/.test(g.clc) },
  { why: '语言读物', test: (g) => /^H/.test(g.clc) || /对照|读物|日语|英语|双语|汉英|汉日/.test(g.title + g.series) },
  { why: '评论/教程（非小说）', test: (g) => /^I0|^I1$|^I106|^I207|^I054|^G|^K|^D|^B/.test(g.clc) || /写作课|创作方法|研究|评论|导读|赏析|辞典|指南|入门/.test(g.subjects + g.title) },
  { why: '非推理主题词', test: (g) => !SUBJ_MYSTERY.test(g.subjects) },
];

const rows = readFileSync(IN, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .slice(1)
  .map((l) => l.split('\t'))
  .map((c) => ({
    tier: c[0], author: c[1], title: c[2], primary: c[3], clc: c[4], year: c[5],
    publisher: c[6], subjects: c[7], series: c[8], isbn: c[9], id: c[10],
  }));

const fresh = [];
const sets = [];
const dropped = [];
for (const g of rows) {
  const rule = DROP_RULES.find((r) => r.test(g));
  if (rule) {
    dropped.push({ ...g, why: rule.why });
    continue;
  }
  const base = baseTitle(g.title);
  const isVolume = base !== String(g.title).trim();
  if (isVolume && inDb(normText(base))) {
    dropped.push({ ...g, why: `套装分卷（母本《${base}》已在库）` });
    continue;
  }
  // 变体比对：去「的」、取后段、去套装词、去系列前缀、后缀等价之后若能对上库内题名，判为已有
  const keys = variantKeys(g.title);
  const own = normText(g.title);
  if (inDbIncludingSelf(own)) {
    dropped.push({ ...g, why: `疑同书异名（库内题名包含原题名：${own}）` });
    continue;
  }
  const matched = keys.find((k) => k !== own && inDb(k));
  if (matched) {
    dropped.push({ ...g, why: `疑同书异名（变体与库内题名一致：${matched}）` });
    continue;
  }
  (isVolume ? sets : fresh).push({ ...g, base });
}

/** 同一本书的重复版本：题名与作者都归一后相同者只留一条（取版本年最晚的） */
const byKey = new Map();
for (const g of fresh) {
  const k = `${normText(g.author)}|${normText(g.title)}`;
  const prev = byKey.get(k);
  if (!prev || Number(g.year || 0) > Number(prev.year || 0)) byKey.set(k, g);
}
const deduped = [...byKey.values()];
const dupEditions = fresh.length - deduped.length;

const write = (suffix, list, withWhy = false) => {
  const head = ['查询作者', '题名', '责任者', '中图法', '版本年', '出版者', '主题词', '丛编', 'ISBN', '馆藏id'];
  if (withWhy) head.push('挡住的原因');
  writeFileSync(
    `${PREFIX}-${suffix}.tsv`,
    [head.join('\t'), ...list.map((g) => [g.author, g.title, g.primary, g.clc, g.year, g.publisher, g.subjects, g.series, g.isbn, g.id, ...(withWhy ? [g.why] : [])].join('\t'))].join('\n') + '\n',
    'utf8',
  );
};
write('new', deduped);
write('set', sets);
write('drop', dropped, true);

console.log(`输入缺口 ${rows.length} 条`);
console.log(`  ✓ 全新作品候选      ${deduped.length}（同书多版本已合并 ${dupEditions} 条）`);
console.log(`  · 套装分卷（母本缺） ${sets.length}`);
console.log(`  ✗ 已挡掉            ${dropped.length}`);
const why = new Map();
for (const d of dropped) {
  const key = d.why.replace(/（.*/, '');
  why.set(key, (why.get(key) || 0) + 1);
}
for (const [k, v] of [...why.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${String(v).padStart(5)}  ${k}`);
console.log(`\n写入 ${PREFIX}-new.tsv / -set.tsv / -drop.tsv`);

const byAuthor = new Map();
for (const g of deduped) (byAuthor.get(g.author) || byAuthor.set(g.author, []).get(g.author)).push(g);
console.log('\n全新作品候选最多的作者：');
for (const [a, list] of [...byAuthor.entries()].sort((x, y) => y[1].length - x[1].length).slice(0, 20)) {
  console.log(`  ${String(list.length).padStart(3)} 部  ${a}   例：${list.slice(0, 3).map((g) => g.title).join('、')}`);
}
