/**
 * 按「检索行主题词」枚举馆藏（**不依赖任何外部来源的发现渠道**）
 * ============================================================
 * 背景：到 2026-09 下旬，所有外部发现渠道都已失效——
 *   豆瓣整站 403、当当检索整体返回「搜索无结果页」、CIP 检索对匿名访问一律 0 页、
 *   国图/上图/CALIS/读秀要么不可达要么需登录（见 docs/collection-backlog.md 第十七节）。
 *   `_dd/gap-titles.txt` 与 `_dd/series-gap.tsv` 两个候选池也已全部消化完毕。
 *
 * 于是回到**馆藏 OPAC 自身**找路：它的**检索结果行里就带「主题词」字段**，
 * 例如 `推理小说 / 长篇小说`。只要用一个宽泛关键词（「推理」「侦探」「密室」…）
 * 翻页，就能把「主题词含推理小说／侦探小说」的条目一条条捞出来——
 * **判据直接来自编目数据，不需要任何第三方来源**。
 *
 * 实测：对外经贸 q=推理 共 235 条，前三页即命中 9 行带推理主题词。
 * 换不同关键词可以得到不同切片，合起来覆盖面相当可观。
 *
 * ⚠️ 两个限制，使用时必须知道：
 *   1. **只覆盖两个馆入藏的书**——两馆没有的书，这条路一样捞不到；
 *   2. 检索行里的主题词是**分面截断后的展示**，正式判定仍应回详情页看「题名主题」
 *      （本工具收集的是**候选**，写条目时用 `opac2:verify` 复核）。
 *
 * 用法：
 *   node scripts/opac-facet-scan.mjs --keywords 推理,侦探,密室 --pages 25 --out _dd/facet.tsv
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { SITES, get, parseList, resultCount, uibeHealth } from './lib/uibe.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = '') => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const keywords = opt('keywords', '推理').split(',').map((s) => s.trim()).filter(Boolean);
const pages = Number(opt('pages', '25'));
const out = opt('out', '_dd/facet.tsv');
const delay = Number(opt('delay', '800'));
const MATCH = /推理小说|侦探小说/;

/** 已抓过的书名（含 sourceId），用于续抓与去重 */
const seen = new Set();
if (existsSync(out)) {
  for (const line of readFileSync(out, 'utf8').split(/\r?\n/)) {
    if (line.trim()) seen.add(line.split('\t')[0]);
  }
  if (seen.size) console.log(`续抓：已有 ${seen.size} 条`);
}

const clean = (s) => String(s ?? '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

let totalHits = 0;
for (const kw of keywords) {
  for (const [site, s] of Object.entries(SITES)) {
    let total = null;
    let scanned = 0;
    let hits = 0;
    console.log(`\n##### 「${kw}」 @ ${SITES[site].label}`);
    for (let p = 1; p <= pages; p++) {
      const offset = (p - 1) * 10;
      const url =
        `${s.base}${s.path}?q=${encodeURIComponent(kw)}` + (offset ? `&pager.offset=${offset}` : '');
      let t;
      try {
        t = await get(url, { pause: delay });
      } catch (e) {
        console.log(`  pg${p} 失败：${e.message}`);
        break;
      }
      if (total === null) total = resultCount(t);
      const list = parseList(t);
      if (!list.length) {
        console.log(`  pg${p}：无结果，停止本关键词`);
        break;
      }
      scanned += list.length;
      const lines = [];
      for (const r of list) {
        if (!r.subjects.some((x) => MATCH.test(x))) continue;
        const key = `${r.title}|${site}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits++;
        totalHits++;
        lines.push([key, site, clean(r.author), clean(r.publisher), clean(r.subjects.join('/')), r.bookId].join('\t'));
      }
      if (lines.length) appendFileSync(out, lines.join('\n') + '\n', 'utf8');
      if (p % 5 === 0 || lines.length) {
        console.log(`  pg${p}：扫 ${list.length} 行，新命中 ${lines.length}（本词累计 ${hits}／共 ${scanned} 行，馆藏 ${total} 条）`);
      }
      await new Promise((r) => setTimeout(r, delay));
    }
    console.log(`  小结：「${kw}」@${site} 扫 ${scanned} 行，命中 ${hits} 条（馆藏共 ${total} 条）`);
  }
}

console.log(`\n本次新增 ${totalHits} 条候选，累计 ${seen.size} 条。结果：${out}`);
console.log(`熔断计数 ${uibeHealth.fails}/${uibeHealth.limit}`);
