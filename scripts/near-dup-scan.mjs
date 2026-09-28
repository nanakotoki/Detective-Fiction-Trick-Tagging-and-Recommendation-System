#!/usr/bin/env node
/**
 * 近似重复扫描 `near-dup-scan`
 * ============================
 * **为什么还要一个判重工具**：`find-duplicates.mjs`（闸门）走的是 `dup-rules.mjs` 的
 * A／B 两条规则——**归一化之后完全相等**才算重复。可是 §150–§154 这五轮里，靠人工捞回来的
 * 八组重复候选**没有一组是「完全相等」**：
 *
 *   · 同音异形字：《恐怖分子的**阳**伞》／库内《…**洋**伞》、《…事件**薄** 8》／库内《…事件**簿**.8》；
 *   · 换个译名：《**脑男**》／刚收的《**脑人**》（同一部 `脳男》）、《密室**推理**游戏》／《密室**杀人**游戏2.0》；
 *   · 分卷／册次／副题：《龙卧亭杀人事件 **下**》《**金田一探案集** 八墓村》《模仿犯**BOOK1**》；
 *   · 宣传语入书名：《夜蝉 **北村薰日常推理代表作**》。
 *
 * 这个脚本把那件事从「靠记性」变成「靠工具」：**同一位作者**＋**题名高度相似**就报出来，
 * 交给人判断。三条实现要点：
 *   ① 相似度用**公共子序列长度**（不要求连续），因为书名差异往往只是中间少／多几个字；
 *   ② 同音异形字（阳／洋、簿／薄、脑人／脑男）靠**字符集重叠**也能报出来——这正是要抓的；
 *   ③ **只报候选，绝不写库**（§137.2：疑似名单只进人工确认队列，绝不直接写库）。
 *
 * 用法：
 *   node scripts/near-dup-scan.mjs                  # 全库自查（同一位作者的书名两两比对）
 *   node scripts/near-dup-scan.mjs --pool _dd/x.tsv [--col 1] [--author-col 2]
 *                                                   # 候选池 vs 库内（池内题名在第 1 列，作者在第 2 列）
 *   node scripts/near-dup-scan.mjs --since data/books/batch-236-opac.json
 *                                                   # **只扫某个批次文件里新收的册次**（本轮新增，§155 待办②）：
 *                                                   # 把它们逐条与**库内其它条目**比一遍，看看有没有
 *                                                   # 「刚收的这一册其实库里早有另一个译名」
 *   node scripts/near-dup-scan.mjs --min 0.62       # 调整阈值（默认 0.62）
 */
import { readFileSync, readdirSync } from 'node:fs';
import { normText } from './lib/dup-rules.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i === -1 ? d : argv[i + 1];
};
const MIN = Number(arg('--min', '0.62'));
const POOL = arg('--pool', '');
const SINCE = arg('--since', '');
const COL = Number(arg('--col', '1')) - 1;
const ACOL = Number(arg('--author-col', '2')) - 1;

/** 最长公共子序列长度（不要求连续） */
function lcs(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = new Array(n + 1).fill(0);
  let cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return prev[n];
}
/** 相似度：公共子序列长度 ÷ 较长题名的长度（长题名夹宣传语时也能报出来） */
const sim = (a, b) => {
  const na = normText(a);
  const nb = normText(b);
  if (!na || !nb) return 0;
  return lcs(na, nb) / Math.max(na.length, nb.length);
};
/** 作者是否可视为同一人（与 dup-rules 同口径，但这里**只在同作者之间比**，宁窄勿宽） */
const sameAuthor = (a, b) => {
  const na = normText(a);
  const nb = normText(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
};

const books = [];
const files = readdirSync('data/books').filter((f) => f.endsWith('.json') && !f.startsWith('_'));
for (const f of files) {
  for (const b of JSON.parse(readFileSync(`data/books/${f}`, 'utf8'))) books.push({ ...b, _file: f });
}
console.log(`全库 ${books.length} 部（${files.length} 个文件），阈值 ${MIN}`);

const hits = [];
if (SINCE) {
  /**
   * `--since <批次文件>`：把**该文件里的册次**逐条与**其它文件里的条目**比。
   * 用来在收完一轮之后自查「刚收的这册，库里是不是早有另一个译名／另一种写法」——
   * 这正是 §155 那五组（万能鉴定士Q … Vol.N）该被自动拦下的场景。
   */
  const fresh = JSON.parse(readFileSync(SINCE, 'utf8'));
  for (const b of fresh) {
    for (const other of books) {
      if (other._file === SINCE.replace(/^data\/books\//, '')) continue;
      if (!sameAuthor(b.author, other.author)) continue;
      const s = sim(b.title, other.title);
      if (s >= MIN) hits.push({ s, poolTitle: b.title, poolAuthor: b.author, title: other.title, author: other.author, file: other._file });
    }
  }
  console.log(`批次 ${SINCE}：${fresh.length} 册 → 与库内其它条目命中 ${hits.length} 组`);
} else if (POOL) {
  const rows = readFileSync(POOL, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
  const head = rows[0];
  const body = /题名|title/.test(head[COL] || '') ? rows.slice(1) : rows;
  for (const r of body) {
    const title = (r[COL] || '').trim();
    const author = (r[ACOL] || '').trim();
    if (!title) continue;
    for (const b of books) {
      if (author && !sameAuthor(author, b.author)) continue;
      const s = sim(title, b.title);
      if (s >= MIN) hits.push({ s, poolTitle: title, poolAuthor: author, title: b.title, author: b.author, file: b._file });
    }
  }
  console.log(`候选池 ${POOL}：${body.length} 行 → 命中 ${hits.length} 组（只列最高的一批）`);
} else {
  for (let i = 0; i < books.length; i += 1) {
    for (let j = i + 1; j < books.length; j += 1) {
      const a = books[i];
      const b = books[j];
      if (!sameAuthor(a.author, b.author)) continue;
      const s = sim(a.title, b.title);
      if (s >= MIN) hits.push({ s, poolTitle: a.title, poolAuthor: a.author, title: b.title, author: b.author, file: b._file });
    }
  }
  console.log(`全库自查：命中 ${hits.length} 组`);
}
hits.sort((x, y) => y.s - x.s);
const TOP = Number(arg('--top', '40'));
for (const h of hits.slice(0, TOP)) {
  console.log(`  ${h.s.toFixed(2)} ｜ ${h.poolTitle} ／ ${h.title} ｜ ${h.author}（${h.file}）`);
}
if (hits.length > TOP) console.log(`  … 另有 ${hits.length - TOP} 组（用 --top N 调整显示条数，--min 调阈值）`);
console.log('\n注意：本脚本**只报候选**，不写库；系列各卷（《×× 2》与《×× 3》）也会落进结果，须人工排除。');
