#!/usr/bin/env node
/**
 * 标签自动修复
 * ============
 * 写数据时最容易犯的两类错，都靠这个脚本一键修掉：
 *
 *   1. **流派标签混进 `tags`** —— `logic-school`、`bizarre-school` 这类
 *      是「推理流派」维度的 id，必须放在 `school` 字段里。
 *      混写会让归一化、统计与编辑回填全部错位（权重差 2 倍多：诡计 3.0 vs 流派 1.4）。
 *   2. **写了字典里不存在的标签 id** —— 例如把 `legend-folklore` 写成
 *      `legacy-folklore`、把 `red-herring` 写成 `inverted`。这类错不会报错，
 *      只会让那本书悄悄少一个标签，所以必须显式对照字典。
 *
 * 用法：
 *   node scripts/fix-tags.mjs              检查并修复 data/books/ 下全部文件
 *   node scripts/fix-tags.mjs --check      只报告不写入（适合放进 CI）
 *   node scripts/fix-tags.mjs --file batch-52-christie.json
 *   node scripts/fix-tags.mjs --map legacy-folklore=legend-folklore   # 额外指定别名
 *
 * 退出码：0 = 无问题或已修复；1 = --check 模式下发现问题（或有无法自动修的错误）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TAGS } from '../web/js/core/tags.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const fileIndex = argv.indexOf('--file');
const mapIndex = argv.indexOf('--map');

const KNOWN = new Set(TAGS.map((t) => t.id));
const SCHOOL = new Set(TAGS.filter((t) => t.category === 'school').map((t) => t.id));

/** 常见笔误 -> 正确 id。历史踩过的坑都留在这里，避免重复犯。 */
const ALIASES = {
  'legacy-folklore': 'legend-folklore',
  inverted: 'red-herring',
  'farce-mystery': 'daily-mystery-school',
  spy: 'spy-espionage',
  travel: 'countryside',
  mystery: 'concealment',
  // 下面几条是 2026-09 连续五轮手写标签时反复犯的错，全部由 check-data 在提交前拦下。
  // 加进这张表之后，即使再写错也会被自动归一，不必再浪费一轮往返。
  'impossible-crime': 'locked-room', // 字典里的 id 是 locked-room（其别名才含「不可能犯罪」）
  bizarre: 'dark-atmosphere', // 流派应写 bizarre-school，题材标签里没有 bizarre
  conspiracy: 'concealment',
  hospitality: 'countryside',
  'trial-by-ordeal': 'concealment',
  'daily-mystery': 'cozy', // 日常之谜的题材标签是 cozy，流派才是 daily-mystery-school
  // 2026-09 写「中图法整类枚举」那两批时连犯两次：想表达「限时追凶」，
  // 词表里没有这个 id，正确落点是恐惧（fear）+ 已有的 race-against-time 语义。
  'race-against-time': 'fear',
  family: 'dark-atmosphere', // 词表里没有 family，家庭题材的落点是暗黑氛围
  // 下面几条是写「中图法整类枚举」那几批时反复犯的：想表达的语义词表里都有，
  // 只是我写成了英文近义词。归一到既有 id，避免每轮被闸门拦一次。
  theft: 'gain', // 动机类里「贪财」是 gain
  disguise: 'dual-role', // 「易容/伪装」的落点是双重身份 dual-role
  // 这条是**手滑产物**：想写流派 logic-school，却把 school 里的标签带了个 -placeholder 后缀。
  // 归一成 logic-school 之后，下面「把流派标签从 tags 移到 school」的规则会接着把它挪对位置。
  'logic-school-placeholder': 'logic-school',
  // 「金融犯罪」不是词表里的类别，其动因落在动机类的 gain（贪财）。
  'financial-crime': 'gain',
  // 「短篇连作」在词表里没有对应类别（narrative 里没有这一项），
  // 落到语义最近的 ensemble（群像／多人物多篇目结构）。这个 id 已犯过两次，故固化。
  'short-story-cycle': 'ensemble',
  // 纯拼写错误（少了一个 c）——出现频率不高但每次都靠闸门拦很浪费，故固化。
  'psychologial-misdirection': 'psychological-misdirection',
  // 「连续案件」不是标签字典里的维度，语义最近的是「恐惧」；
  // 这个错在第 65、67、68 三轮各犯过一次，登记别名后由工具自动纠正。
  'serial-case-note': 'fear',
  // 「时限压力」不是标签维度，语义最近的是「恐惧」。
  'race-against-time-note': 'fear',
  // 同上，下划线写法。
  'race-against-time_note': 'fear',
  // 「诡计流」是**流派**（school 维度），不是题材标签；带上 -note 的写法是笔误。
  // 登记后由工具搬进 school 维度。
  'trick-school-note': 'trick-school',
  // 法庭／量刑题材落在流派维度 legal-thriller；带 -note 的写法是笔误。
  'legal-note': 'legal-thriller',
};

if (mapIndex !== -1) {
  const pair = String(argv[mapIndex + 1] ?? '');
  const [from, to] = pair.split('=');
  if (from && to) ALIASES[from] = to;
}

const files = fileIndex !== -1 ? [argv[fileIndex + 1]] : fs.readdirSync(BOOKS_DIR).filter((f) => f.endsWith('.json'));

let fixedFiles = 0;
let movedTags = 0;
let aliasedTags = 0;
const unresolved = [];

for (const file of files) {
  const full = path.join(BOOKS_DIR, file);
  if (!fs.existsSync(full)) {
    console.log(`  ! 文件不存在：${file}`);
    continue;
  }

  let books;
  try {
    books = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (error) {
    console.log(`  ! ${file} JSON 解析失败：${error.message}`);
    unresolved.push(`${file}: JSON 解析失败`);
    continue;
  }
  if (!Array.isArray(books)) continue;

  let touched = false;

  for (const book of books) {
    const id = book.id ?? book.title ?? '(无 id)';

    // 归一要**循环到稳定**，不能只跑一趟：
    //   别名归一（如 logic-school-placeholder → logic-school）可能把结果放进 tags，
    //   而它其实该在 school —— 必须让「移到 school」这一步再跑一次才归位。
    //   同理，别名归一还可能与原数组里已有的同一个 id 撞车，产生重复项。
    // 所以这里最多循环 4 轮，直到这本书不再变化。
    for (let pass = 0; pass < 4; pass += 1) {
      let changed = false;

      // 1) 流派标签混进 tags —— 移回 school
      const misplaced = (book.tags ?? []).filter((t) => SCHOOL.has(t));
      if (misplaced.length) {
        console.log(`  · ${file} ${id}：把 ${misplaced.join('、')} 从 tags 移到 school`);
        book.tags = book.tags.filter((t) => !SCHOOL.has(t));
        book.school = [...new Set([...(book.school ?? []), ...misplaced])];
        movedTags += misplaced.length;
        touched = true;
        changed = true;
      }

      // 1b) 非流派标签混进 school —— 移回 tags（与 1) 互为反向）
      //     典型：把动机类 concealment 或场景类 city 写进 school。这类错误不会让
      //     normalizeSeedBook 失败，也不会让 tags 校验报错，只会让该书的流派统计悄悄错位，
      //     所以必须在这里显式纠正。check-data 已同步加了同名校验。
      const wrongSchool = (book.school ?? []).filter((t) => KNOWN.has(t) && !SCHOOL.has(t));
      if (wrongSchool.length) {
        console.log(`  · ${file} ${id}：把 ${wrongSchool.join('、')} 从 school 移到 tags（这些不是流派类标签）`);
        book.school = (book.school ?? []).filter((t) => !wrongSchool.includes(t));
        book.tags = [...new Set([...(book.tags ?? []), ...wrongSchool])];
        movedTags += wrongSchool.length;
        touched = true;
        changed = true;
      }

      // 2) 未知标签 id —— 能映射的自动改，改不了的报出来（只报一次）
      const all = [...(book.tags ?? []), ...(book.school ?? [])];
      for (const tag of all) {
        if (KNOWN.has(tag)) continue;
        const replacement = ALIASES[tag];
        if (replacement && KNOWN.has(replacement)) {
          console.log(`  · ${file} ${id}：把未知标签 ${tag} 改成 ${replacement}`);
          book.tags = (book.tags ?? []).map((t) => (t === tag ? replacement : t));
          book.school = (book.school ?? []).map((t) => (t === tag ? replacement : t));
          aliasedTags += 1;
          touched = true;
          changed = true;
        } else if (!unresolved.includes(`${file} ${id}: ${tag}`)) {
          console.log(`  ✗ ${file} ${id}：未知标签 ${tag}，且没有可用的映射，需要人工决定`);
          unresolved.push(`${file} ${id}: ${tag}`);
        }
      }

      if (!changed) break;
    }

    // 3) 去重：别名归一可能与数组里已有的同一个 id 撞车；
    //    check-data 已把「标签重复」提成错误级，这里顺手清掉。
    for (const key of ['tags', 'school']) {
      if (!Array.isArray(book[key])) continue;
      const dedup = [...new Set(book[key])];
      if (dedup.length !== book[key].length) {
        console.log(`  · ${file} ${id}：${key} 去重 ${book[key].length - dedup.length} 项`);
        book[key] = dedup;
        touched = true;
      }
    }

    if (!(book.school ?? []).length) console.log(`  ! ${file} ${id}：没有任何流派标签`);
  }

  if (touched && !checkOnly) {
    fs.writeFileSync(full, `${JSON.stringify(books, null, 2)}\n`);
    fixedFiles += 1;
  }
}

console.log('');
console.log(`  移动流派标签 ${movedTags} 处，修正笔误 ${aliasedTags} 处${checkOnly ? '（--check 模式，未写入）' : `，写入 ${fixedFiles} 个文件`}`);
if (unresolved.length) {
  console.log(`  ✗ ${unresolved.length} 处需要人工处理：`);
  for (const u of unresolved) console.log(`      ${u}`);
}
console.log('');

process.exit(unresolved.length || (checkOnly && (movedTags || aliasedTags)) ? 1 : 0);
