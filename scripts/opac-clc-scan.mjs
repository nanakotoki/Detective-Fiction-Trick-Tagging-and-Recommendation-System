/**
 * 按**中图法分类号**整类枚举馆藏（`opac2` 版）
 * =============================================
 * **为什么这是最值钱的一条渠道**：中图法把「侦探／推理小说」单列了复分号——
 *   `I247.56` 中国当代、`I246.56` 中国近代、`I313.456` 日本、
 *   `I561.456` 英国、`I712.456` 美国、`I565.456` 法国、`I516.456` 德国……
 * 分类号是给排架用的，**不随编目员措辞变化**，比「主题词含推理小说」更不可争辩。
 * 所以按它整类拉一遍，等于把该馆收藏的推理小说**按定义**兜底扫一遍。
 *
 * **怎么找到这个用法的**（记下来，免得以后再走弯路）：
 *   1. 先试过丛书名（午夜文库、蜘蛛文库…）当检索词 —— **不可用**。
 *      全字段检索是按词切分的，「午夜文库」命中的是「中国金融**文库**」「**午夜**花园」，
 *      一本午夜文库的书都没有。
 *   2. 又试过 `field=subjectSearch` / `seriesSearch` —— **都是无效参数**，
 *      传了会静默退化成全库列表（48k 条）。
 *   3. 读检索表单源码后确认 `field` 只认 6 个值，其中 `callNumberSearch` 有效；
 *      而**索书号要带 `*` 通配才能匹配到带书次号的那些**
 *      （`I247.56` 只命中 4 条，`I247.56*` 命中 502 条 —— 差别就是 `I247.56/S50` 这类）。
 *
 * ⚠️ 仍是别人学校的服务器：默认 850ms 间隔、并发 1、带 `uibeHealth` 熔断、结果增量落盘。
 */
import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { get, resultCount, parseList, SITES, uibeHealth } from './lib/uibe.mjs';

const PAGE = 10;

/** 本项目关心的推理小说复分号（`.456` 一档），按语区列全 */
export const MYSTERY_CLASSES = [
  { clc: 'I247.56', label: '中国当代侦探／推理小说' },
  { clc: 'I246.56', label: '中国近代侦探／推理小说' },
  { clc: 'I313.456', label: '日本侦探／推理小说' },
  { clc: 'I561.456', label: '英国侦探／推理小说' },
  { clc: 'I712.456', label: '美国侦探／推理小说' },
  { clc: 'I565.456', label: '法国侦探／推理小说' },
  { clc: 'I516.456', label: '德国侦探／推理小说' },
];

/** 取一页「按索书号」结果（注意 `*` 通配，否则带书次号的书全部漏掉） */
async function clcPage(clc, offset, site) {
  const s = SITES[site];
  const qs = `q=${encodeURIComponent(`${clc}*`)}&field=callNumberSearch` + (offset ? `&pager.offset=${offset}` : '');
  const html = await get(`${s.base}${s.path}?${qs}`);
  return { rows: parseList(html), count: resultCount(html) };
}

/**
 * 枚举单个类号下的馆藏。
 *
 * `onlyMystery`：只保留**检索行主题词含「推理小说／侦探小说」**的行。
 * 用途是扫「大类号」——例如 `I313.45` 有 2620 条，绝大多数是普通小说，
 * 但里面混着该馆**没有细分到 `.456`** 的推理小说；用主题词过一遍就能挑出来。
 * 注意：`.456` 那七个细分号本身就是判据，扫它们时**不要**开这个开关。
 */
export async function scanClass(clc, { site = 'uibe', max = 1200, pause = 850, verbose = false, onlyMystery = false } = {}) {
  const rows = [];
  let total = null;
  let empty = 0;
  for (let offset = 0; offset < max; offset += PAGE) {
    if (offset) await new Promise((r) => setTimeout(r, pause));
    let page;
    try {
      page = await clcPage(clc, offset, site);
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
    const keep = onlyMystery
      ? page.rows.filter((r) => /推理小说|侦探小说/.test((r.subjects || []).join(' ')))
      : page.rows;
    rows.push(...keep);
    if (verbose) console.log(`    offset=${offset} 本页 ${page.rows.length} 行、留 ${keep.length}、累计 ${rows.length}/${total}`);
    if (total !== null && offset + PAGE >= total) break;
  }
  return { clc, total, rows };
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : d;
  };
  const out = arg('--out', '_dd/clc-scan.tsv');
  const site = arg('--site', 'uibe');
  const pause = Number(arg('--delay', '850'));
  const max = Number(arg('--max', '1200'));
  const onlyMystery = argv.includes('--only-mystery');
  const only = (arg('--classes', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  // --classes 传的是**任意类号**（不限于 MYSTERY_CLASSES），这样才能扫 `.45` 那一档大类
  const list = (only.length ? only : MYSTERY_CLASSES.map((c) => c.clc)).map((clc) => ({ clc }));

  const done = new Set();
  if (existsSync(out)) {
    for (const line of readFileSync(out, 'utf8').split(/\r?\n/)) {
      const c = line.split('\t');
      if (c[1] === '__DONE__') done.add(c[0]);
    }
  } else writeFileSync(out, '', 'utf8');

  let grand = 0;
  for (const { clc } of list) {
    if (done.has(clc)) {
      console.log(`跳过（已完成）${clc}`);
      continue;
    }
    try {
      const r = await scanClass(clc, { site, max, pause, verbose: false, onlyMystery });
      const seen = new Set();
      const lines = [];
      for (const row of r.rows) {
        if (seen.has(row.bookId)) continue;
        seen.add(row.bookId);
        lines.push([clc, row.title, row.author, row.callNumber, row.publisher, row.isbn, row.subjects.join('/'), row.bookId].join('\t'));
      }
      if (lines.length) appendFileSync(out, lines.join('\n') + '\n', 'utf8');
      appendFileSync(out, `${clc}\t__DONE__\t${r.total}\t${r.rows.length}\t${lines.length}\n`, 'utf8');
      grand += lines.length;
      console.log(`【${clc}】馆藏 ${r.total} 条，扫 ${r.rows.length} 行，去重后 ${lines.length} 条`);
    } catch (e) {
      console.log(`【${clc}】✗ ${e.message}`);
      break; // 熔断即整体停
    }
    await new Promise((res) => setTimeout(res, pause));
  }
  console.log(`\n完成，共 ${grand} 条，熔断计数 ${uibeHealth.fails}/${uibeHealth.limit}，结果写入 ${out}`);
}

main().catch((e) => {
  console.error('失败：', e.message);
  process.exit(1);
});
