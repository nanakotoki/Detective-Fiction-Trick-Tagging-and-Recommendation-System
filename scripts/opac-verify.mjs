#!/usr/bin/env node
/**
 * 扬州市图书馆 OPAC 书目核实（**题材判定的硬证据来源**）
 * =====================================================
 * 为什么需要它：用户的扩面口径是「可以扩充，但是确保是推理小说」。
 * 豆瓣简介是出版社写的营销文案，判「是不是推理」只能靠里面的字眼间接推断；
 * 而图书馆的编目数据里有两个**直接、可核验**的字段：
 *
 *   · **中图法分类号**：`I247.56` ＝ 中国当代侦探/推理小说，
 *     `I313.45`／`I561.45` 等外国文学类下也常配「侦探小说」主题词；
 *   · **学科主题**：直接写「侦探小说」「推理小说」「长篇小说」。
 *
 * 再加上**出版发行项**（最早版本的出版社与年月，用于核 `firstPublished`）
 * 与**提要文摘附注**（编目员摘要，通常比豆瓣简介克制），
 * 这一条来源就能同时解决「是不是推理」和「首版是哪一年」两个问题。
 *
 * ⚠️ 两条硬规矩（与 fetch-blurb.mjs 相同）：
 *   1. 提要**只作撰写依据，绝不直接入库**——自己重写 ≤100 字并过 check-data 泄底闸门；
 *   2. 判据要写进该条的 `verification.source`，注明分类号／主题词／marc_no，
 *      日后任何人可照 marc_no 复核。
 *
 * 用法：
 *   node scripts/opac-verify.mjs 刀锋上的救赎 青之毒 ...
 *   node scripts/opac-verify.mjs --author 谢筠深 夏日萤火    按责任者过滤同名版本（**强烈建议带上**）
 *   node scripts/opac-verify.mjs --file scripts/_cand.txt
 *   node scripts/opac-verify.mjs --marc 0000204056        直接取某条详情
 *   node scripts/opac-verify.mjs --quiet 刀锋上的救赎       只印一张紧凑表
 *
 * ⚠️ 同名不同作者：馆藏里常有书名相同、作者不同的书（《夏日萤火》就有谢筠深
 * I247.56 与江小绿 I247.57 两种）。不带 `--author` 时工具会取有分类号的最早一版，
 * **可能选到别人的书**，从而把答案judge反。给了 `--author` 而没有任何一版对得上时，
 * 工具会**拒绝猜测**并报「未能核实」。
 */


import { BASE, UA, strip, get, field, fields, parseList, detail, clcVerdict, opacHealth } from './lib/opac.mjs';

/** 熔断阈值：连续这么多条取不到就整站停手（理由见下方主循环里的注释） */
const FAILURE_LIMIT = 8;

opacHealth.reset();

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const mi = argv.indexOf('--marc');
const fi = argv.indexOf('--file');
const ai = argv.indexOf('--author');

const args = {
  /** 按责任者过滤同名版本。同名书在馆藏里可能有好几本不同作者，不给这个就会选错 */
  author: ai !== -1 ? argv[ai + 1] : '',
};

let titles = argv.filter((a, i) => !a.startsWith('--') && !(ai !== -1 && i === ai + 1));
let marcs = [];
if (mi !== -1) {
  marcs = argv.slice(mi + 1).filter((a) => /^\d+$/.test(a));
  titles = [];
}
if (fi !== -1) {
  const fs = await import('node:fs');
  titles = fs
    .readFileSync(argv[fi + 1], 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}
if (!titles.length && !marcs.length) {
  console.log('\n  用法：node scripts/opac-verify.mjs <书名...> | --file <清单> | --marc <marc_no...> [--quiet]\n');
  process.exit(1);
}

// 解析与抓取逻辑统一在 scripts/lib/opac.mjs 里（与 opac-author.mjs 共用一份实现）

const results = [];
if (marcs.length) {
  for (const m of marcs) {
    try {
      results.push(await detail(m));
    } catch (e) {
      console.log(`marc ${m}\t抓取失败：${e.message}`);
    }
  }
} else {
  for (const t of titles) {
    let list = [];
    try {
      list = parseList(await get(`${BASE}/openlink.php?title=${encodeURIComponent(t)}`));
    } catch (e) {
      console.log(`\n【${t}】列表抓取失败：${e.message}`);
      // 失败路径同样要过熔断检查——早先把它只放在成功路径上，
      // 结果站点挂掉时 catch 里的 continue 直接绕过检查，一路空转到清单跑完。
      if (opacHealth.failures >= FAILURE_LIMIT) {
        console.log(
          `\n  ✗ 连续 ${opacHealth.failures} 条都取不到，已中止以免把馆藏站点打到限流。\n` +
            `    请隔一段时间再试，并把清单拆小一点分批跑。\n`
        );
        break;
      }
      continue;
    }
    if (!list.length) {
      console.log(`\n【${t}】⚠ 馆藏无结果（该书可能未入藏，需换来源核实）`);
      continue;
    }
    // 取最早的一版做详情（最早版才有资格定 firstPublished）；电子资源版不参与
    const sorted = [...list]
      .filter((e) => !/电子图书/.test(e.name) && !/^E\d/.test(e.callno))
      .sort((a, b) => String(a.year).localeCompare(String(b.year)));

    /**
     * **同名不同作者**是这套工具最大的坑，必须逐版取详情比对责任者。
     *
     * 实例：《夏日萤火》馆藏里有三种——谢筠深（新星 2017，**I247.56**）、
     * 江小绿（百花文艺 2022，**I247.57**）、以及一条电子版。只按年份排序取第一条，
     * 会取到江小绿那本，于是「不是推理」——**答案完全反了**。
     * 所以这里把候选各版的题名责任者都取出来，人多一眼就能看出选错了哪本。
     */
    const details = [];
    for (const cand of sorted.slice(0, 4)) {
      try {
        const d = await detail(cand.marc);
        if (d.titleRaw || d.clc) details.push({ ...d, listYear: cand.year, callno: cand.callno });
      } catch {
        /* 换下一个 */
      }
    }

    const norm = (s) => String(s || '').replace(/\s+/g, '');
    const wanted = args.author ? norm(args.author) : '';
    const matchesAuthor = (d) => wanted && norm(d.titleRaw).includes(wanted);

    // 有 --author 时只认责任者对得上的版本；对不上就**宁可报无结果**，不猜。
    let d = null;
    if (wanted) {
      d = details.find(matchesAuthor) ?? null;
    } else {
      // 没给作者：优先取有分类号的，再取年份最早的
      d = details.find((x) => x.clc) ?? details[0] ?? null;
    }

    if (wanted && !d) {
      console.log(`\n【${t}】⚠ 馆藏有 ${details.length} 个同名版本，但没有一个的责任者匹配「${args.author}」：`);
      for (const x of details) console.log(`    ${x.titleRaw || '(无题名责任者)'}  ${x.clc || ''}`);
      console.log('    → 拒绝猜测，本条题材未能核实。');
      continue;
    }

    results.push({ query: t, editions: list, allDetails: details, ...(d || {}) });

    /**
     * 熔断：连续太多次取不到就停手。
     *
     * 起因见 docs/collection-backlog.md 第二节末的事故记录——`opac-author --all`
     * 一次性打上千次请求，把 `opac.yzlib.cn` 打到整站拒连，两条路径一起废掉好几天。
     * 这个脚本按 `--file` 批量跑时同样会连续请求，所以也装上同一道保险。
     */
    if (opacHealth.failures >= FAILURE_LIMIT) {
      console.log(
        `\n  ✗ 连续 ${opacHealth.failures} 条都取不到，已中止以免把馆藏站点打到限流。\n` +
          `    请隔一段时间再试，并把清单拆小一点分批跑。\n`
      );
      break;
    }
  }
}

for (const r of results) {
  if (QUIET) {
    console.log(
      [
        (r.query || '').padEnd(18),
        String(r.publine || '').padEnd(30),
        String(r.clc || '').padEnd(9),
        (r.subjects || []).join('/'),
      ].join(' | ')
    );
    continue;
  }
  console.log(`\n【${r.query || r.marc}】`);
  if (r.marc) console.log(`  采用版本：marc ${r.marc}`);
  if (r.allDetails?.length > 1) {
    console.log(`  同名候选 ${r.allDetails.length} 版（**务必核对责任者，别选错同名书**）：`);
    for (const x of r.allDetails) {
      const hit = r.marc === x.marc ? '←采用' : '  ';
      console.log(`    ${hit} ${x.titleRaw || '(无)'}  ${x.publine || ''}  ${x.clc || ''}`);
    }
  }
  if (r.editions?.length > 1) {
    console.log(`  馆藏版本 ${r.editions.length} 种（按年）：`);
    for (const e of r.editions) console.log(`    ${e.year || '?'}  ${e.name}  索书号 ${e.callno}  marc ${e.marc}`);
  }
  if (r.titleRaw) console.log(`  题名责任：${r.titleRaw}`);
  if (r.publine) console.log(`  出版发行：${r.publine}`);
  if (r.isbn) console.log(`  ISBN　　：${r.isbn}`);
  if (r.carrier) console.log(`  载体形态：${r.carrier}`);
  if (r.series) console.log(`  丛编项　：${r.series}`);
  if (r.clc) console.log(`  中图法　：${r.clc}`);
  if (r.subjects?.length) console.log(`  学科主题：${r.subjects.join(' / ')}`);
  console.log(`  ▶ 题材判读：${clcVerdict(r.clc, r.subjects || []).join('；')}`);
  if (r.abstract) console.log(`  提要（**只作依据，须自行重写**）：${r.abstract.slice(0, 300)}`);
}
