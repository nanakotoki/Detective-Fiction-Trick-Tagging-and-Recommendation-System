#!/usr/bin/env node
/**
 * 知识库数据校验 / 反剧透体检
 * ============================
 * 用法：
 *   node scripts/check-data.mjs            常规校验（高危项失败退出）
 *   node scripts/check-data.mjs --strict   严格模式（可疑项也视为失败）
 *   node scripts/check-data.mjs --json     输出机器可读结果
 *
 * 校验内容：
 *   1. JSON 合法性与去重
 *   2. 字段结构完整性（含 ratings 三平台、vault 为空）
 *   3. 标签 id 是否全部在字典内
 *   4. 无剧透简介字数 ≤ 100
 *   5. 用 safety.js 的同款规则引擎扫描全部公开文本
 *   6. 报告每个标签的收录数量，便于发现误标（0 部或极多的标签）
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TAG_MAP, TAGS, tagCategory } from '../web/js/core/tags.js';
import { analyzeBook, countChars } from '../web/js/core/safety.js';
import { normalizeSeedBook, GENRE_OPTIONS, canonicalGenre, splitAuthors } from '../web/js/core/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');

const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict');
const AS_JSON = argv.includes('--json');

const REQUIRED_RATING_PLATFORMS = ['douban', 'hupu', 'goodreads'];

const C = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  cyan: '\u001b[36m',
};
const color = (text, code) => (process.stdout.isTTY ? `${code}${text}${C.reset}` : String(text));

async function main() {
  const errors = [];
  const warnings = [];
  const infos = [];
  /** 署名作者 ≥2 的条目数（多作者模型启用后用于汇总） */
  let multiAuthor = 0;
  /** 标了 `anthology`（多人合集，界面上打醒目徽章）的条目数 */
  let anthology = 0;

  let files;
  try {
    const all = (await fs.readdir(BOOKS_DIR)).filter((f) => f.endsWith('.json')).sort();
    // 下划线前缀为脚本/整理的临时文件，不参与校验（也不应被提交）
    files = all.filter((f) => !f.startsWith('_'));
    const scratch = all.filter((f) => f.startsWith('_'));
    if (scratch.length && !AS_JSON) {
      console.log(color(`  i 已忽略临时文件：${scratch.join(', ')}`, C.dim));
    }
  } catch {
    console.error(color(`✗ 找不到数据目录：${BOOKS_DIR}`, C.red));
    process.exit(1);
  }

  if (!files.length) {
    console.error(color(`✗ ${BOOKS_DIR} 下没有任何 .json 文件`, C.red));
    process.exit(1);
  }

  // 命名规范：必须以 batch-NN-xxx.json 形式命名。
  // 批次号已超过 99，故允许 2～3 位数字（batch-100-… 是合法的）。
  const badNames = files.filter((f) => !/^batch-\d{2,3}-[a-z0-9-]+\.json$/.test(f));
  for (const name of badNames) {
    warnings.push(`${name}: 文件命名不符合 batch-NN-<slug>.json 规范，建议改名以便统一加载与排序`);
  }

  const seenIds = new Map();
  const seenTitles = new Map();
  const seenAltTitles = new Map();
  const allBooks = [];

  for (const file of files) {
    const fullPath = path.join(BOOKS_DIR, file);
    let raw;
    try {
      raw = await fs.readFile(fullPath, 'utf8');
    } catch (error) {
      errors.push(`${file}: 读取失败 —— ${error.message}`);
      continue;
    }

    if (raw.charCodeAt(0) === 0xfeff) warnings.push(`${file}: 文件含 BOM，建议保存为 UTF-8 无 BOM`);

    let list;
    try {
      list = JSON.parse(raw);
    } catch (error) {
      errors.push(`${file}: JSON 解析失败 —— ${error.message}`);
      continue;
    }

    if (!Array.isArray(list)) {
      errors.push(`${file}: 顶层必须是数组`);
      continue;
    }

    list.forEach((item, index) => {
      const where = `${file}[${index}]`;

      // ---- 结构校验 ----
      for (const key of ['id', 'title', 'author', 'genre', 'safeSummary', 'tags', 'ratings']) {
        if (item?.[key] === undefined || item?.[key] === null || item?.[key] === '') {
          errors.push(`${where}: 缺少必填字段 ${key}`);
        }
      }

      // ---- 署名作者列表（多作者模型） ----
      // `author` 是展示标签，`authors` 才是统计口径（见 web/js/core/seed.js 的注释）。
      // 两者一旦脱节，作者榜与「同作者」推荐会给出看似合理但错误的结果，
      // 而且页面上完全看不出来，所以在这里显式校验。
      const authorLabel = String(item?.author ?? '').trim();
      if (Array.isArray(item?.authors)) {
        const bad = item.authors.filter((a) => typeof a !== 'string' || !a.trim());
        if (bad.length) errors.push(`${where}: authors 里存在空值或非字符串项`);
        const dupA = item.authors.filter((a, i) => item.authors.indexOf(a) !== i);
        if (dupA.length) warnings.push(`${where}: authors 有重复项 —— ${[...new Set(dupA)].join('、')}`);
        if (item.authors.length && authorLabel && !item.authors.some((a) => authorLabel.includes(String(a)))) {
          errors.push(
            `${where}: author「${authorLabel}」与 authors（${item.authors.join('、')}）脱节——` +
              `展示标签至少要包含一位署名作者`
          );
        }
      } else if (item?.authors !== undefined) {
        errors.push(`${where}: authors 必须是数组`);
      } else if (authorLabel && splitAuthors(authorLabel).length > 1) {
        // 老数据只写了 author 且含「、」：归一化时会自愈出 authors，
        // 但数据文件里没写，容易让下一个人以为模型还是单作者——提示补上。
        infos.push(`${where}: author 含多位作者但未显式给 authors 数组，归一化时会自动拆分为 ${splitAuthors(authorLabel).join(' / ')}`);
      }
      if (Array.isArray(item?.authors) && item.authors.length > 1) multiAuthor += 1;

      // ---- 多人合集标记（纯展示：界面上的醒目徽章） ----
      if (item?.anthology !== undefined && typeof item.anthology !== 'boolean') {
        errors.push(`${where}: anthology 必须是布尔值`);
      }
      if (item?.anthology === true) {
        anthology += 1;
        if (!authorLabel) errors.push(`${where}: 标了合集却没有作者标签`);
      }

      // ---- 体裁必须在规范列表内 ----
      // canonicalGenre 会把无法识别的体裁归到「其他」，**页面上看不出异常**，
      // 但体裁筛选就再也筛不到这本书了（《法律与淑女》曾被写成「维多利亚推理」，
      // 归一结果直接是「其他」）。这里在数据层就拦住。
      if (item?.genre !== undefined && item?.genre !== null && item?.genre !== '') {
        const rawGenre = String(item.genre).trim();
        if (!GENRE_OPTIONS.includes(rawGenre)) {
          warnings.push(
            `${where}: 体裁「${rawGenre}」不在规范列表内，会被归一为「${canonicalGenre(rawGenre)}」；` +
              `可选值：${GENRE_OPTIONS.join(' / ')}`
          );
        }
      }

      const id = String(item?.id ?? '');
      if (!/^[a-zA-Z0-9._-]{1,64}$/.test(id)) {
        errors.push(`${where}: id「${id}」不符合 ^[a-zA-Z0-9._-]{1,64}$`);
      }
      if (seenIds.has(id)) {
        errors.push(`${where}: id「${id}」与 ${seenIds.get(id)} 重复`);
      } else {
        seenIds.set(id, where);
      }

      const title = String(item?.title ?? '');
      if (seenTitles.has(title)) {
        warnings.push(`${where}: 书名《${title}》与 ${seenTitles.get(title)} 重复（可能是同一本书的两个版本）`);
      } else {
        seenTitles.set(title, where);
      }

      // ---- 两个「年」字段（2026-09 拆分，见 docs/collection-backlog.md 第十一节）----
      // firstPublished ＝ 作品首次出版年（原作年），查不到可留空；
      // editionYear    ＝ 本库所引版本的出版年（通常是中译本），有来源可核验。
      // 两者语义不同，**不允许把同一个值同时填进两栏**——那等于又混回一个字段。
      for (const key of ['firstPublished', 'editionYear']) {
        const v = String(item?.[key] ?? '').trim();
        if (!v) continue;
        if (!/\d{4}/.test(v)) {
          errors.push(`${where}: ${key} 里看不出四位数年份（当前「${v}」）`);
        }
        if (v.length > 40) {
          errors.push(`${where}: ${key} 过长（${v.length} 字，上限 40）`);
        }
      }
      if (
        String(item?.firstPublished ?? '').trim() &&
        String(item?.firstPublished ?? '').trim() === String(item?.editionYear ?? '').trim()
      ) {
        warnings.push(
          `${where}: firstPublished 与 editionYear 填了同一个值（${item.firstPublished}）——` +
            `前者是作品原作年、后者是本库所引版本的年，请确认是否其中之一填错；` +
            `若本来就相同（中文原创作品），把 editionYear 留空即可`
        );
      }

      // ---- 又名（alternateTitles）----
      // 合并重复条目时，落选那一版的中文书名会保留在这里。它必须是
      // 干净的字符串数组，且不能与本书自己的书名重复（那是合并逻辑的 bug）。
      if (item?.alternateTitles !== undefined) {
        if (!Array.isArray(item.alternateTitles)) {
          errors.push(`${where}: alternateTitles 必须是数组`);
        } else {
          const alts = item.alternateTitles.map((t) => String(t ?? '').trim());
          if (alts.some((t) => !t)) errors.push(`${where}: alternateTitles 含空字符串`);
          if (new Set(alts).size !== alts.length) warnings.push(`${where}: alternateTitles 有重复项`);
          if (alts.includes(title)) errors.push(`${where}: alternateTitles 里出现了本书自己的书名《${title}》`);
          for (const a of alts.filter(Boolean)) {
            if (seenAltTitles.has(a)) {
              warnings.push(`${where}: 又名《${a}》与 ${seenAltTitles.get(a)} 重复`);
            } else {
              seenAltTitles.set(a, where);
            }
          }
        }
      }

      // ---- 标签校验 ----
      const tags = Array.isArray(item?.tags) ? item.tags : [];
      const unknown = tags.filter((t) => !TAG_MAP[t]);
      if (unknown.length) errors.push(`${where}: 未收录的标签 id —— ${unknown.join('、')}`);
      const dupTags = tags.filter((t, i) => tags.indexOf(t) !== i);
      // 重复标签一律是 bug（标签页的「收录数」会多算），所以是错误而不是警告。
      // 之所以会有这种事：fix-tags 的别名归一（如 disguise → dual-role）可能与
      // 原数组里已有的同一个 id 撞车，归一后必须再去一次重。
      if (dupTags.length) errors.push(`${where}: 标签重复 —— ${[...new Set(dupTags)].join('、')}`);

      // ---- 流派校验 ----
      // school 是与 tags 正交的第二个维度（权重差 2 倍多），只能放 category === 'school' 的标签。
      // 把动机/场景类标签写进 school 不会让 check-data 报错、也不会让归一化失败，
      // 但会让该书的流派统计与加权悄悄错位，所以在这里显式拦住。
      const schools = Array.isArray(item?.school) ? item.school : [];
      const badSchool = schools.filter((t) => !TAG_MAP[t] || TAG_MAP[t].category !== 'school');
      if (badSchool.length) {
        const detail = badSchool
          .map((t) => (TAG_MAP[t] ? `${t}（属于「${TAG_MAP[t].category}」类，应放进 tags）` : `${t}（未收录的标签 id）`))
          .join('、');
        errors.push(`${where}: school 字段里放了非流派标签 —— ${detail}`);
      }
      const dupSchool = schools.filter((t, i) => schools.indexOf(t) !== i);
      if (dupSchool.length) warnings.push(`${where}: 流派重复 —— ${[...new Set(dupSchool)].join('、')}`);

      const trickCount = tags.filter((t) => tagCategory(t) === 'trick').length;
      /**
       * **诡计类标签按体裁分级告警**（第 72 轮）。
       *
       * 起因：全库 726 条没有诡计类标签，早先一律报 warning，噪音极大。
       * 但实测下来，这 726 条里 479 条属 `犯罪悬疑／社会派／硬汉派／冒险悬疑` ——
       * **这些体裁本来就不以「诡计机制」为核心**，没有诡计标签是**正确状态**，
       * 不该按同一标准问责。真正值得复核的是**本格系**（本格推理／新本格／变格）：
       * 那 152 条才是「可能漏标」的地方。
       *
       * 反例存档：batch-172 的《玻璃密室》题名带「密室」，馆藏却没有任何提要能证明
       * 它是本格意义上的密室杀人，当时**故意没标** `locked-room`——所以「题名有线索词」
       * 从不作为判据，这一条也写进了 `scripts/suggest-trick-tags.mjs` 的注释。
       */
      const TRICK_EXPECTED_GENRES = ['本格推理', '新本格', '变格'];
      if (trickCount === 0) {
        const line = `${where}: 没有任何「诡计类」标签`;
        if (TRICK_EXPECTED_GENRES.includes(String(item?.genre))) {
          warnings.push(`${line}（体裁为「${item.genre}」，属**诡计应为卖点**的一类，请复核是否漏标）`);
        } else {
          infos.push(`${line}（体裁「${item?.genre || '未填'}」不以诡计机制为核心，通常无需补标）`);
        }
      } else if (trickCount < 2) {
        infos.push(`${where}: 仅有 ${trickCount} 个诡计类标签，建议补充`);
      }

      // ---- 简介字数 ----
      const summary = String(item?.safeSummary ?? '');
      const summaryLen = countChars(summary);
      if (summaryLen > 100) {
        errors.push(`${where}: 无剧透简介 ${summaryLen} 字，超出需求文档规定的 100 字上限`);
      } else if (summaryLen < 12) {
        warnings.push(`${where}: 无剧透简介仅 ${summaryLen} 字，信息量可能不足`);
      }

      // ---- 平台评分结构 ----
      for (const platform of REQUIRED_RATING_PLATFORMS) {
        const entry = item?.ratings?.[platform];
        if (!entry || typeof entry !== 'object') {
          errors.push(`${where}: ratings.${platform} 缺失（无数据时也应写 { score: null, summary: "暂无数据" }）`);
          continue;
        }
        if (!('score' in entry)) errors.push(`${where}: ratings.${platform}.score 字段缺失`);
        if (entry.score !== null && entry.score !== undefined && typeof entry.score !== 'number') {
          warnings.push(`${where}: ratings.${platform}.score 不是数字（${JSON.stringify(entry.score)}）`);
        }
        if (entry.score === null || entry.score === undefined) {
          if (!entry.summary) warnings.push(`${where}: ratings.${platform} 无评分但也无说明文字`);
        }
      }

      // ---- 保险库必须为空 ----
      const vault = item?.vault ?? {};
      const filledVault = ['culprit', 'coreTrick', 'ending', 'notes'].filter((k) => vault[k]);
      if (filledVault.length) {
        errors.push(
          `${where}: vault.${filledVault.join('、vault.')} 非空。种子知识库严禁存储谜底内容（若为个人笔记请改存 server/data）。`,
        );
      }

      // ---- 反剧透扫描 ----
      const normalized = normalizeSeedBook(item, null, file);
      if (normalized) {
        const report = analyzeBook(normalized);
        for (const issue of report.issues) {
          const line = `${where}《${title}》【${issue.fieldLabel ?? issue.field}】命中「${issue.match}」：…${issue.excerpt}…`;
          if (issue.risk === 'high') errors.push(line);
          else if (issue.risk === 'medium') {
            (STRICT ? errors : warnings).push(`${line}\n      → ${issue.hint}`);
          } else {
            infos.push(`${line}\n      → ${issue.hint}`);
          }
        }
        allBooks.push(normalized);
      }
    });
  }

  /* ---------------- 又名与书名交叉核对 ---------------- */
  // 如果某本书的「又名」正好等于另一本书的**书名**，说明这两个条目多半是
  // 同一部作品却没被合并——`scripts/merge-dups.mjs` 应该先处理掉它们。
  // 单遍扫描抓不到这种「先看到又名、后看到书名」的情况，所以放在全量收集之后再查。
  {
    const byPrimary = new Map();
    for (const b of allBooks) byPrimary.set(String(b.title ?? '').trim(), b);
    for (const b of allBooks) {
      for (const alt of b.alternateTitles ?? []) {
        const other = byPrimary.get(String(alt).trim());
        if (other && other.id !== b.id) {
          warnings.push(
            `《${b.title}》(id=${b.id}) 的又名「${alt}」是另一条目《${other.title}》(id=${other.id}) 的书名，疑似未合并的重复条目`
          );
        }
      }
    }
  }

  /* ---------------- 标签分布 ---------------- */
  // 流派（school）是与诡计类正交的第二个维度，存在 schoolTags 字段而非 tags，
  // 统计时必须一并扫描，否则会被误报成「尚未被使用的标签」。
  const tagCounts = new Map();
  for (const book of allBooks) {
    for (const t of book.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    for (const t of book.schoolTags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const unusedTags = TAGS.filter((t) => !tagCounts.has(t.id));
  const singleUse = TAGS.filter((t) => tagCounts.get(t.id) === 1);

  /* ---------------- 输出 ---------------- */
  if (AS_JSON) {
    console.log(
      JSON.stringify(
        {
          ok: errors.length === 0,
          files: files.length,
          books: allBooks.length,
          errors,
          warnings,
          unusedTags: unusedTags.map((t) => t.label),
        },
        null,
        2,
      ),
    );
    process.exit(errors.length ? 1 : 0);
  }

  console.log('');
  console.log(color('  知识库反剧透体检', C.bold));
  console.log(color('  ────────────────────────────────────────────', C.dim));
  console.log(`  数据文件     ${files.length} 个（${files.join(', ')}）`);
  console.log(`  作品总数     ${color(String(allBooks.length), C.bold)} 部`);
  console.log(`  标签字典     ${TAGS.length} 个标签 / ${new Set(TAGS.map((t) => t.category)).size} 个类别`);
  console.log(`  实际用到     ${tagCounts.size} 个标签`);
  console.log(`  多作者条目   ${color(String(multiAuthor), multiAuthor ? C.bold : C.dim)} 部（署名作者 ≥2，统计与推荐按作者列表计）`);
  console.log(`  其中合集     ${color(String(anthology), anthology ? C.bold : C.dim)} 部（界面上打「合集」徽章；**统计口径不变**，仍计入各署名作者）`);
  console.log('');

  // 分类统计
  const catOrder = ['trick', 'narrative', 'scene', 'motive', 'theme'];
  const catLabels = { trick: '诡计类', narrative: '叙事类', scene: '场景类', motive: '动机类', theme: '氛围题材类' };
  console.log(color('  标签分布', C.bold));
  for (const cat of catOrder) {
    const items = TAGS.filter((t) => t.category === cat)
      .map((t) => ({ label: t.label, n: tagCounts.get(t.id) ?? 0 }))
      .sort((a, b) => b.n - a.n);
    const used = items.filter((i) => i.n > 0);
    console.log(
      `  ${catLabels[cat].padEnd(6, '　')} ${String(used.length).padStart(2)}/${String(items.length).padStart(2)} 个被使用   ` +
        color(used.slice(0, 8).map((i) => `${i.label}(${i.n})`).join(' '), C.dim),
    );
  }

  const schoolItems = TAGS.filter((t) => t.category === 'school')
    .map((t) => ({ label: t.label, n: tagCounts.get(t.id) ?? 0 }))
    .sort((a, b) => b.n - a.n);
  if (schoolItems.length) {
    const usedSchool = schoolItems.filter((i) => i.n > 0);
    const multiSchool = allBooks.filter((b) => (b.schoolTags ?? []).length > 1).length;
    const noSchool = allBooks.filter((b) => !(b.schoolTags ?? []).length).length;
    console.log('');
    console.log(color('  推理流派（正交维度，存于 schoolTags）', C.bold));
    console.log(
      `  ${'流派'.padEnd(6, '　')} ${String(usedSchool.length).padStart(2)}/${String(schoolItems.length).padStart(2)} 个被使用   ` +
        color(usedSchool.slice(0, 8).map((i) => `${i.label}(${i.n})`).join(' '), C.dim),
    );
    console.log(
      color(
        `  多流派标注 ${multiSchool} 部，未标注 ${noSchool} 部${noSchool ? '（建议补齐）' : ''}`,
        noSchool ? C.yellow : C.dim,
      ),
    );
  }
  console.log('');

  if (errors.length) {
    console.log(color(`  ✗ 错误 ${errors.length} 项`, C.red + C.bold));
    for (const e of errors) console.log(`    ${color('✗', C.red)} ${e}`);
    console.log('');
  }

  if (warnings.length) {
    console.log(color(`  ! 警告 ${warnings.length} 项`, C.yellow + C.bold));
    for (const w of warnings.slice(0, 40)) console.log(`    ${color('!', C.yellow)} ${w}`);
    if (warnings.length > 40) console.log(color(`    … 另有 ${warnings.length - 40} 条`, C.dim));
    console.log('');
  }

  if (infos.length && STRICT) {
    console.log(color(`  i 提示 ${infos.length} 项（严格模式下不影响结果）`, C.blue));
    for (const i of infos.slice(0, 10)) console.log(`    ${color('i', C.blue)} ${i}`);
    console.log('');
  }

  if (unusedTags.length) {
    console.log(color(`  i 尚未被使用的标签（${unusedTags.length} 个）`, C.dim));
    console.log(color(`    ${unusedTags.map((t) => t.label).join('、')}`, C.dim));
    console.log('');
  }

  const passed = errors.length === 0;
  if (passed) {
    console.log(color(`  ✓ 体检通过${warnings.length ? '（有警告，可自行确认）' : ''}`, C.green + C.bold));
    console.log(color('    全部公开字段未检出高危泄底表述，字段结构与字数均符合规范。', C.dim));
  } else {
    console.log(color(`  ✗ 体检未通过：${errors.length} 项错误需要修复`, C.red + C.bold));
  }
  console.log('');

  process.exit(passed ? 0 : 1);
}

main().catch((error) => {
  console.error(color(`\n✗ 校验脚本异常：${error.stack ?? error.message}\n`, C.red));
  process.exit(1);
});
