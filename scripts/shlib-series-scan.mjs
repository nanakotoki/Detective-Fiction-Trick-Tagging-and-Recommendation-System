/**
 * 按**丛编**枚举上海图书馆馆藏（`shlib-series-scan`）
 * ==================================================
 * 候选池是按作者枚举出来的（§59，`shlib-author-scan.mjs`），到 §121 已经见底：
 * **尚余 240 条、最大一组只有 4 条**。这一轮换一条**正交的轴**——出版丛书：
 * 「午夜文库」「日本推理小说文库」「大唐狄公案」这类**推理专门丛书**的卷次是有限集合，
 * 逐卷对库就能看出缺口，而且**不限于库里已有的作者**。
 *
 * 渠道可用性由 `_dd/_probe-series122.mjs` 探明（见 `lib/shlib.mjs` 的 `searchSeriesPage` 注释）：
 * `type=Series` 是**真的丛编索引**，「午夜文库」命中 1120 条，记录同样带完整 CNMARC。
 *
 * **输出与候选池同格式**（10 列：查询丛编／题名／责任者／中图法／版本年／出版者／主题词／丛编／ISBN／馆藏 id），
 * 于是 `scripts/pool-left.mjs --file <本脚本产物>` 可以直接算余量——扣库内题名、口径排除项、
 * 以及 `data/not-collected.json` 里已判不另立条目的候选。
 *
 * 用法：
 *   node scripts/shlib-series-scan.mjs --series 午夜文库,日本推理小说文库 --out _dd/shlib-series.tsv
 *   node scripts/shlib-series-scan.mjs --file _dd/series-list.txt
 * 选项：--out  --delay 600  --max 400（每个丛编最多取回多少条）
 * 断点续跑：已写入 `__DONE__` 的丛编自动跳过。
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { scanSeries } from './lib/shlib.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const OUT = arg('--out', '_dd/shlib-series.tsv');
const DELAY = Number(arg('--delay', '600'));
const MAX = Number(arg('--max', '400'));
const HEADER = ['查询丛编', '题名', '责任者', '中图法', '版本年', '出版者', '主题词', '丛编', 'ISBN', '馆藏id'].join('\t');

const inline = (arg('--series', '') || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
const listFile = arg('--file', '');
const series = inline.length
  ? inline
  : listFile
    ? readFileSync(listFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))
    : [];
if (!series.length) {
  console.log('\n  用法：node scripts/shlib-series-scan.mjs --series 午夜文库,日本推理小说文库 [--out x.tsv]\n');
  process.exit(1);
}
console.log(`待枚举丛编 ${series.length} 个 → ${OUT}（每个最多 ${MAX} 条，间隔 ${DELAY}ms）\n`);

const done = new Set();
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split(/\r?\n/)) {
    const c = line.split('\t');
    if (c[1] === '__DONE__') done.add(c[0]);
  }
} else {
  writeFileSync(OUT, HEADER + '\n', 'utf8');
}

let miss = 0;
let hit = 0;
let consecutiveFail = 0;
for (const name of series) {
  if (done.has(name)) continue;
  let res = null;
  try {
    res = await scanSeries(name, { max: MAX, delay: DELAY });
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
  const count = res.count ?? 0;
  const recs = res.records ?? [];
  if (!count) {
    miss += 1;
    appendFileSync(OUT, `${name}\t__DONE__\t0\t0\t0\n`, 'utf8');
    console.log(`【${name}】✗ 上图丛编索引无命中`);
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
        name, r.title, [r.primaryAuthor, ...r.authors.filter((a) => a !== r.primaryAuthor)].filter(Boolean).join('、'),
        r.clc, r.year, (r.publishers || []).join('/'), r.subjects.join(' ; '), (r.series || []).join('/'),
        r.isbn, r.id,
      ].join('\t') + '\n',
      'utf8',
    );
    kept += 1;
  }
  appendFileSync(OUT, `${name}\t__DONE__\t${count}\t${recs.length}\t${kept}\n`, 'utf8');
  console.log(`【${name}】✓ 上图著录 ${count} 条，取回 ${recs.length}，写入 ${kept} 行`);
}
console.log(`\n完成：命中 ${hit} 个丛编、无命中 ${miss} 个；结果 → ${OUT}`);
