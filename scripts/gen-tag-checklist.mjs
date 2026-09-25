#!/usr/bin/env node
/**
 * 生成「稀有诡计标签核对清单」
 * ============================
 * 诡计标签里数量少、指向具体的那几个（无面尸、交换杀人、童谣杀人、
 * 凶器消失、一人二角、暗号密码、时刻表诡计），一旦标错对推荐的伤害最大：
 * 它们权重 3.0，会把两本毫不相干的书强行拉近。
 *
 * 相比之下「红鲱鱼」出现在 77% 的作品里，标错也几乎不产生区分度
 * （引擎已自动将其识别为背景标签）。
 *
 * 本脚本把稀有标签逐条列成 Markdown 清单，供人工抽查。
 * 输出：docs/标签核对清单.md
 *
 * 用法：node scripts/gen-tag-checklist.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_FILES } from '../web/js/core/seed-files.js';
import { TAG_MAP } from '../web/js/core/tags.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', '标签核对清单.md');

/** 数量少、指向具体的诡计标签——这些标错的代价最大 */
const RARE = ['faceless-corpse', 'swap-murder', 'nursery-rhyme', 'vanished-weapon', 'dual-role', 'cipher', 'timetable'];

const books = [];
for (const { data } of SEED_FILES) for (const raw of Array.isArray(data) ? data : []) books.push(raw);

let md = '# 稀有诡计标签核对清单\n\n';
md += '> 本文件由 `npm run audit:checklist` 生成，用于人工抽查标注准确性。\n\n';
md += '诡计标签权重为 **3.0**，是推荐算法的第一优先级，因此标错的代价很大。\n';
md += '这里只列出**数量少、指向具体**的那几个——它们一旦标错，会把两本毫不相干的书强行拉近。\n\n';
md += '相对地，「红鲱鱼」（77% 的作品）与「心理误导」（61%）属于泛化标签，\n';
md += '出现率过高、区分度低，引擎已把出现率 >70% 的标签自动识别为**背景标签**、不参与相似度计算。\n\n';
md += '**发现标错的，告诉我 `id` + 标签即可。**\n';

const lines = [];
let total = 0;

for (const id of RARE) {
  const tag = TAG_MAP[id];
  const hits = books.filter((b) => (b.tags ?? []).includes(id));
  total += hits.length;
  lines.push('');
  lines.push(`## ${tag.label}（${hits.length} 部）`);
  lines.push('');
  lines.push(`> ${tag.desc}`);
  lines.push('');
  for (const b of hits) {
    lines.push(`- [ ] \`${b.id}\` 《${b.title}》 — ${b.author}`);
  }
}

md += lines.join('\n');
md += '\n';

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, md, 'utf8');

console.log('');
console.log(`  ✓ 已生成 ${path.relative(ROOT, OUT)}`);
console.log(`    共 ${RARE.length} 类标签、${total} 条标注待核对`);
console.log('');
for (const id of RARE) {
  const n = books.filter((b) => (b.tags ?? []).includes(id)).length;
  console.log(`    ${TAG_MAP[id].label.padEnd(6, '　')} ${n} 部`);
}
console.log('');
