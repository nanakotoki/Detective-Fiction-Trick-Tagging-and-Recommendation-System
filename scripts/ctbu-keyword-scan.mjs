/**
 * 第二馆关键词枚举（`ctbu-keyword-scan`）
 * ======================================
 * **为什么需要它**：此前所有枚举都建立在第一个馆（对外经贸）之上。
 * 第二个馆（重庆工商大学，金盘 OPAC）的馆藏与之**并不重合**——
 * 例如它独有《从密室里救出黑猫的方法》（北山猛邦 2025）、《2025 年中国悬疑推理小说精选》（2026）等。
 *
 * **两个已探明的坑**（免得再走弯路）：
 *   1. 该馆**不支持按分类号／索书号检索**——`q=I247.56`（含 `*` 通配）都取不到结果，
 *      所以不能在它这里「整类枚举」，只能按关键词。
 *   2. **列表页的行大多没有主题词**，但**详情页有**。
 *      所以判据必须去详情页取，不能像第一个馆那样在列表页筛。
 *
 * 判据（与全库一致，第①类）：详情页主题词含「推理小说」或「侦探小说」。
 * 同时用标题排除明显非小说的（史／研究／词典／游戏／大全／导读／赏析／论）。
 */
import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { get, SITES, parseList, detail } from './lib/uibe.mjs';

const NON_FICTION = /史|研究|词典|辞典|游戏|大全|导读|赏析|教程|入门|指南|概论|论纲|讲义|選|选集导读|资料|年鉴|书目|文学史/;

async function ctbuPage(keyword, page, pause) {
  const s = SITES.ctbu;
  const qs = `q=${encodeURIComponent(keyword)}` + (page > 1 ? `&page=${page}` : '');
  const html = await get(`${s.base}${s.path}?${qs}`);
  return parseList(html, 'ctbu');
}

export async function scanKeyword(keyword, { maxPages = 6, pause = 700, verbose = false } = {}) {
  const out = [];
  const seen = new Set();
  for (let page = 1; page <= maxPages; page += 1) {
    if (page > 1) await new Promise((r) => setTimeout(r, pause));
    let rows = [];
    try {
      rows = await ctbuPage(keyword, page, pause);
    } catch (e) {
      if (verbose) console.log(`    ${keyword} p${page} 失败：${e.message}`);
      break;
    }
    if (!rows.length) break;
    let fresh = 0;
    for (const row of rows) {
      if (!row.bookId || seen.has(row.bookId)) continue;
      seen.add(row.bookId);
      fresh += 1;
      // 明显不是小说的直接跳过，省一次详情请求
      if (NON_FICTION.test(row.title) && !/事件|案|密室|杀人|死亡|失踪/.test(row.title)) continue;
      await new Promise((r) => setTimeout(r, pause));
      try {
        const d = await detail(row.bookId, { site: 'ctbu' });
        const subj = d.subjects || '';
        if (!/推理小说|侦探小说/.test(subj)) continue;
        out.push({
          keyword,
          title: row.title,
          author: d.author || row.author || '',
          imprint: d.imprint || row.publisher || '',
          clc: d.clc || '',
          subjects: subj,
          series: d.series || '',
          abstract: (d.abstract || '').replace(/\s+/g, ' '),
          bookId: row.bookId,
        });
      } catch {
        /* 单条失败不打断 */
      }
    }
    if (verbose) console.log(`    ${keyword} p${page}：本页 ${rows.length} 行、新 ${fresh}`);
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : d;
  };
  const out = arg('--out', '_dd/ctbu-scan.tsv');
  const kwArg = arg('--keywords', '');
  const keywords = kwArg
    ? kwArg.split(',').map((s) => s.trim()).filter(Boolean)
    : ['密室', '推理小说', '侦探', '命案', '谋杀', '悬案', '不在场证明', '名侦探', '侦探社', '杀人事件', '犯罪心理', '法医', '诡计', '本格', '凶手', '凶器', '毒杀', '绑架', '失踪', '推理作家'];
  const pause = Number(arg('--delay', '700'));

  const done = new Set();
  if (existsSync(out)) {
    for (const line of readFileSync(out, 'utf8').split(/\r?\n/)) {
      const c = line.split('\t');
      if (c[1] === '__DONE__') done.add(c[0]);
    }
  } else writeFileSync(out, '', 'utf8');

  let grand = 0;
  for (const kw of keywords) {
    if (done.has(kw)) {
      console.log(`跳过（已完成）${kw}`);
      continue;
    }
    const recs = await scanKeyword(kw, { maxPages: 6, pause, verbose: false });
    const lines = recs.map((r) => [kw, r.title, r.author, r.imprint, r.clc, r.subjects, r.series, r.abstract, r.bookId].join('\t'));
    if (lines.length) appendFileSync(out, lines.join('\n') + '\n', 'utf8');
    appendFileSync(out, `${kw}\t__DONE__\t${recs.length}\n`, 'utf8');
    grand += recs.length;
    console.log(`【${kw}】命中推理主题词 ${recs.length} 条`);
  }
  console.log(`\n完成，共 ${grand} 条 → ${out}`);
}

main().catch((e) => {
  console.error('失败：', e.message);
  process.exit(1);
});
