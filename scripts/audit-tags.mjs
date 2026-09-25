#!/usr/bin/env node
/**
 * 诡计标签「文本支撑」审计
 * ========================
 * 背景：整理时存在**用泛化标签凑数**的倾向——不确定具体诡计时，
 * 就补一个「红鲱鱼」或「心理误导」。结果这两个标签的使用率高到不合理：
 *   红鲱鱼 329/430 = 77%
 *   心理误导 262/430 = 61%
 * 而真正具体的诡计标签很稀少（童谣杀人 11、凶器消失 10、交换杀人 2）。
 *
 * 这类标签不是「错」，而是**没有依据**——它让推荐算法把两本毫不相干的书
 * 判为「核心诡计同属心理误导」，比缺标签更有害。
 *
 * 本脚本做一件事：检查每个诡计标签在**无剧透简介**里是否有任何文本支撑。
 * 简介写的是作品公开的设定与悬念，如果连简介都看不出某个诡计的迹象，
 * 这个标注就很可能是凑数。输出供人工复核，不自动改动数据。
 *
 * 用法：
 *   node scripts/audit-tags.mjs                # 全库审计
 *   node scripts/audit-tags.mjs --book western-005
 *   node scripts/audit-tags.mjs --tag faceless-corpse
 *   node scripts/audit-tags.mjs --json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_FILES } from '../web/js/core/seed-files.js';
import { TAGS, TAG_MAP } from '../web/js/core/tags.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const onlyBook = (() => {
  const i = argv.indexOf('--book');
  return i === -1 ? null : argv[i + 1];
})();
const onlyTag = (() => {
  const i = argv.indexOf('--tag');
  return i === -1 ? null : argv[i + 1];
})();

const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

/**
 * 每个诡计标签的「文本支撑信号」。
 *
 * 简介里出现这些词，说明该诡计在作品设定层面是公开可见的；
 * 一个都没有 → 该标注缺少依据，需要人工确认。
 *
 * 注意：这是**启发式**检查，不是证明。命中不等于标注正确
 * （简介可能只是恰好用了某个词），不命中也不等于一定错
 * （作者可能刻意不透露）。它的价值在于把 400 多部里
 * 明显凑数的那批挑出来。
 */
const SUPPORT = {
  'locked-room': ['密室', '自内', '内侧锁', '反锁', '上锁', '无法出入', '不可能'],
  alibi: ['不在场', '证明', '时刻', '时间差', '行踪'],
  'narrative-trick': ['叙述', '视角', '人称', '读到最', '重读', '结构本身'],
  timetable: ['时刻表', '班次', '列车', '时刻', '行程'],
  'faceless-corpse': ['身份不明', '认不出', '无人认得', '面目', '无法辨认', '毁容', '误认', '顶替'],
  'vanished-weapon': ['凶器', '消失', '找不到', '不见'],
  'closed-circle': ['封闭', '与外界隔绝', '无法离开', '孤岛', '暴风雪', '被困', '出不去', '孤立'],
  'multiple-solutions': ['多重', '几种解释', '层层', '推翻', '逐一', '排除法', '重新检视'],
  'psychological-misdirection': ['误导', '误认', '错觉', '假象', '认知', '记忆', '失忆', '心理', '暗示', '错觉'],
  'red-herring': ['误导', '假线索', '红鲱鱼', '障眼', '陷阱', '转移注意', '伪装'],
  'swap-murder': ['交换', '互相', '两组', '对应关系', '同时'],
  'nursery-rhyme': ['童谣', '歌谣', '诗', '歌词', '儿歌', '传说'],
  cipher: ['暗号', '密码', '符号', '字条', '加密', '解读'],
  'dual-role': ['一人二角', '两个身份', '双重身份', '冒充', '替身', '伪装成', '变装'],
};

function loadBooks() {
  const out = [];
  for (const { file, data } of SEED_FILES) {
    for (const raw of Array.isArray(data) ? data : []) out.push({ ...raw, _file: file });
  }
  return out;
}

const trickIds = TAGS.filter((t) => t.category === 'trick').map((t) => t.id);

function unsupported(book) {
  const text = `${book.safeSummary ?? ''} ${book.editorialNote ?? ''} ${(book.readingTips?.watchFor ?? []).join(' ')}`;
  const out = [];
  for (const id of book.tags ?? []) {
    if (!trickIds.includes(id)) continue;
    const signals = SUPPORT[id];
    if (!signals) continue;
    if (!signals.some((s) => text.includes(s))) out.push(id);
  }
  return out;
}

const books = loadBooks();
let targets = books;
if (onlyBook) targets = targets.filter((b) => b.id === onlyBook);

const rows = [];
for (const b of targets) {
  const miss = unsupported(b);
  const filtered = onlyTag ? miss.filter((id) => id === onlyTag) : miss;
  if (filtered.length) rows.push({ book: b, missing: filtered });
}

if (AS_JSON) {
  console.log(
    JSON.stringify(
      {
        total: targets.length,
        flagged: rows.length,
        items: rows.map((r) => ({
          id: r.book.id,
          title: r.book.title,
          author: r.book.author,
          file: r.book._file,
          unsupported: r.missing,
          labels: r.missing.map((id) => TAG_MAP[id]?.label ?? id),
        })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

// 汇总：哪个标签最常「无支撑」
const perTag = new Map();
for (const r of rows) for (const id of r.missing) perTag.set(id, (perTag.get(id) ?? 0) + 1);

console.log('');
console.log(color('  诡计标签「文本支撑」审计', C.bold));
console.log(color('  ────────────────────────────────────────────', C.dim));
console.log(`  检查 ${targets.length} 部，${rows.length} 部存在「标注了但简介里看不出依据」的诡计标签`);
console.log('');

const totalUse = new Map();
for (const b of books) for (const id of b.tags ?? []) totalUse.set(id, (totalUse.get(id) ?? 0) + 1);

console.log(color('  按标签汇总（无支撑数 / 全库使用数）', C.bold));
for (const [id, n] of [...perTag.entries()].sort((a, b) => b[1] - a[1])) {
  const total = totalUse.get(id) ?? 0;
  const pct = ((n / total) * 100).toFixed(0);
  console.log(`    ${String(n).padStart(3)} / ${String(total).padStart(3)}  (${String(pct).padStart(3)}%)  ${TAG_MAP[id]?.label ?? id}`);
}
console.log('');

if (onlyBook || rows.length <= 40) {
  console.log(color('  明细', C.bold));
  for (const r of rows) {
    console.log(`    ${r.book.id.padEnd(14)} 《${r.book.title}》`);
    console.log(color(`        ${r.missing.map((id) => TAG_MAP[id]?.label ?? id).join('、')}`, C.yellow));
    console.log(color(`        ${r.book.safeSummary}`, C.dim));
  }
} else {
  console.log(color('  （明细较多，用 --json 或 --book <id> 查看具体条目）', C.dim));
}
console.log('');
