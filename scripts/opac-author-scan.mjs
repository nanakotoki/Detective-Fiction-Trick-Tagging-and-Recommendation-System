/**
 * 按作者枚举馆藏（`opac2` 版）
 * ============================
 * **为什么需要它**：用户给收藏定下的策略是「**尽量每个作者弄全**」，
 * 而此前几轮一直记录「作者枚举不可能」——那是**旧馆 OPAC** 的结论。
 * 2026-09 重新读对外经贸 OPAC 的检索表单后发现有救：
 *
 *   1. `field` 参数**只认表单里列出的那几个值**
 *      （`title` / `abstract` / `creatorSearch` / `publisher` / `isbnSearch` / `callNumberSearch`），
 *      传别的值（如 `subjectSearch`、`seriesSearch`）会让检索**退化成全库列表**——
 *      上一轮之所以误判「作者枚举是 no-op」，就是踩了这个。
 *   2. `field=creatorSearch` 是**真的可用**的，且结果行**逐条带「主题词」分面**。
 *      于是「按作者枚举 + 行内主题词直证推理」这条链路一下子通了。
 *
 * 判据纪律：本工具**只做候选发现**，保留的行必须**行内主题词命中「推理小说/侦探小说」**；
 * 入库前仍要走 `detail()` 取完整著录复核（行内主题词是分面截断后的展示）。
 *
 * ⚠️ 仍受 `uibeHealth` 熔断约束：对方是别人学校的服务器，默认 800ms 间隔、并发 1。
 */
import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { get, resultCount, parseList, SITES, uibeHealth } from './lib/uibe.mjs';

const PAGE = 10;
const MYSTERY = /推理小说|侦探小说/;

/** 取一页「按作者」检索结果 */
async function authorPage(name, offset, site) {
  const s = SITES[site];
  const qs =
    `q=${encodeURIComponent(name)}&field=creatorSearch` + (offset ? `&pager.offset=${offset}` : '');
  const html = await get(`${s.base}${s.path}?${qs}`);
  return { rows: parseList(html), count: resultCount(html) };
}

/**
 * 枚举单个作者，返回**行内主题词命中推理**的行
 * @returns {{name:string, total:number|null, scanned:number, hits:object[]}}
 */
export async function scanAuthor(name, { site = 'uibe', max = 60, pause = 800, verbose = false } = {}) {
  const hits = [];
  let total = null;
  let scanned = 0;
  let empty = 0;
  for (let offset = 0; offset < max; offset += PAGE) {
    if (offset) await new Promise((r) => setTimeout(r, pause));
    let page;
    try {
      page = await authorPage(name, offset, site);
    } catch (e) {
      if (verbose) console.log(`    offset=${offset} 失败：${e.message}`);
      break;
    }
    if (total === null) total = page.count;
    if (!page.rows.length) {
      if (++empty >= 2) break;
      continue;
    }
    empty = 0;
    scanned += page.rows.length;
    for (const r of page.rows) {
      const subj = (r.subjects || []).join(' ');
      if (MYSTERY.test(subj)) hits.push({ ...r, subjectsText: subj });
    }
    if (verbose) console.log(`    offset=${offset} +${page.rows.length} 命中累计 ${hits.length}`);
    if (total !== null && offset + PAGE >= total) break;
  }
  return { name, total, scanned, hits };
}

/** 命令行：node scripts/opac-author-scan.mjs --authors a,b,c [--out file] [--max 60] [--site uibe] */
async function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : d;
  };
  const out = arg('--out', '_dd/author-scan.tsv');
  const max = Number(arg('--max', '60'));
  const pause = Number(arg('--delay', '800'));
  const site = arg('--site', 'uibe');
  const only = (arg('--authors', '') || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);

  const authors = only.length
    ? only
    : readFileSync(arg('--file', ''), 'utf8')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

  // 断点续跑：已在 out 里出现的作者跳过
  const done = new Set();
  if (existsSync(out)) {
    for (const line of readFileSync(out, 'utf8').split(/\r?\n/)) {
      const c = line.split('\t');
      if (c[1] === '__DONE__') done.add(c[0]);
    }
  }
  if (!existsSync(out)) writeFileSync(out, '', 'utf8');

  for (const name of authors) {
    if (done.has(name)) {
      console.log(`跳过（已完成）${name}`);
      continue;
    }
    try {
      const r = await scanAuthor(name, { site, max, pause, verbose: false });
      const seen = new Set();
      for (const h of r.hits) {
        const key = h.title;
        if (seen.has(key)) continue;
        seen.add(key);
        appendFileSync(out, `${name}\t${h.title}\t${h.author}\t${h.subjectsText}\t${h.publisher}\t${h.isbn}\t${h.bookId}\n`, 'utf8');
      }
      appendFileSync(out, `${name}\t__DONE__\t${r.total}\t${r.scanned}\t${r.hits.length}\n`, 'utf8');
      console.log(`【${name}】馆藏 ${r.total} 条，扫 ${r.scanned} 行，行内主题词命中推理 ${r.hits.length} 条`);
    } catch (e) {
      console.log(`【${name}】✗ ${e.message}`);
      break; // 熔断触发即整体停
    }
    await new Promise((res) => setTimeout(res, pause));
  }
  console.log(`\n完成，熔断计数 ${uibeHealth.fails}/${uibeHealth.limit}，结果写入 ${out}`);
}

// 顶层直接执行（与 opac-facet-scan.mjs 一致）。
// 不用 `import.meta.url === file://${process.argv[1]}` 那种守卫：Windows 下
// `import.meta.url` 是 `file:///C:/…`（三斜杠 + 百分号编码），与 argv[1] 的原生路径不同形，
// 比较恒为 false，脚本会**静默什么都不做**——本轮就踩了一次。
main().catch((e) => {
  console.error('失败：', e.message);
  process.exit(1);
});

