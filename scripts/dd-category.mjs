/**
 * 当当分类页枚举（**按分类整类抓取**）
 * ==================================
 * 背景：2026-09 豆瓣整站 403、馆藏 OPAC 不可达，当当成了唯一可用外源。
 * 起先只用它按书名速查，但书名检索只能验证「已知书名」，
 * 无法回答「这个分类里还有哪些我没收」——而项目的目标恰恰是**尽可能收全**。
 *
 * 2026-09 发现：当当分类页可翻页，且支持 5 种排序，每种排序给出**不同的前 N 条切片**。
 * 于是同一分类下能取到的去重条目远多于单一排序的页数上限。
 * 例：侦探/悬疑/推理（cp01.03.38）共 32.9 万件商品（含大量网络小说/盗墓类）。
 *
 * ⚠️ 三条纪律
 *  1. **当当不是编目数据**：没有中图法、没有学科主题。它只能用来**发现候选**与
 *     取简介/出版信息；题材判据必须另行取证（见 docs/collection-backlog.md §10）。
 *  2. **不能替代馆藏/豆瓣的题材判据**，只能作为线索来源。
 *  3. 频率克制：默认 700ms 间隔、连续 3 页空即停；历史上把 OPAC 扫挂过一次，
 *     这里宁可慢。
 *
 * 用法：
 *   node scripts/dd-category.mjs --cat 01.03.38.00.00.00 --sort srsort_pubdate_desc \
 *        --from 1 --to 60 --out _dd/cat-pubdate.tsv
 *   （省略 --out 只打印统计；重复运行同一 --out 会**跳过已抓条目**并续抓）
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fetchDecoded, parseSearch, strip } from './lib/dangdang.mjs';

const argv = process.argv.slice(2);
const opt = (name, dflt = '') => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const cat = opt('cat', '01.03.38.00.00.00');
const sort = opt('sort', 'srsort_default');
const from = Number(opt('from', '1'));
const to = Number(opt('to', '20'));
const out = opt('out');
const delay = Number(opt('delay', '700'));
const EMPTY_LIMIT = Number(opt('empty-limit', '3'));

/** 分类页 URL：第 1 页无 pg 前缀，之后 pg<N>- */
const urlFor = (p) =>
  p === 1
    ? `http://category.dangdang.com/cp${cat}-${sort}.html`
    : `http://category.dangdang.com/pg${p}-cp${cat}-${sort}.html`;

/** 续抓：已存在的结果文件里的商品 id 不再重复写 */
const seen = new Set();
const fileRows = [];
if (out && existsSync(out)) {
  for (const line of readFileSync(out, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    fileRows.push(line);
    seen.add(line.split('\t')[0]);
  }
  console.log(`续抓：结果文件已有 ${seen.size} 条，本次只补新条目`);
}

const clean = (s) =>
  strip(s)
    .replace(/加入购物车收藏.*$/, '')
    .replace(/收藏.*$/, '')
    .trim();

let empty = 0;
let fetched = 0;
let fresh = 0;
const newLines = [];
for (let p = from; p <= to; p++) {
  let rows;
  try {
    rows = parseSearch(await fetchDecoded(urlFor(p)));
  } catch (e) {
    console.log(`pg${p} 请求失败：${e.message}`);
    if (++empty >= EMPTY_LIMIT) {
      console.log(`连续 ${EMPTY_LIMIT} 次失败/空页，停止`);
      break;
    }
    await new Promise((r) => setTimeout(r, delay * 2));
    continue;
  }
  fetched += rows.length;
  const add = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    add.push(
      [r.id, clean(r.title), r.authorLine.replace(/加入购物车收藏.*$/, ''), clean(r.detail)].join('\t')
    );
  }
  fresh += add.length;
  newLines.push(...add);
  console.log(`pg${p}\t解析 ${rows.length}\t新增 ${add.length}\t累计 ${seen.size}`);
  // 增量落盘：历史上因为「只在结束时写文件」丢过整轮成果
  if (out && add.length) appendFileSync(out, add.join('\n') + '\n', 'utf8');

  if (rows.length === 0) {
    if (++empty >= EMPTY_LIMIT) {
      console.log(`连续 ${EMPTY_LIMIT} 页无结果，停止`);
      break;
    }
  } else empty = 0;
  await new Promise((r) => setTimeout(r, delay));
}

console.log(
  `\n分类 cp${cat} 排序 ${sort}：抓取 ${fetched} 条，去重后 ${seen.size} 条（本次新增 ${fresh}）` +
    (out ? `\n结果：${out}` : '')
);
void fileRows;
void newLines;
