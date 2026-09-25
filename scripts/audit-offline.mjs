#!/usr/bin/env node
/**
 * 离线质量体检
 * ============
 * 抓不到豆瓣时（限流）仍可做的事：**不联网**地检查知识库自身的数据质量。
 *
 * 查的是几类"看不出来但影响使用"的问题：
 *   1. 无剧透梗概过短 —— 读者点进去等于没有信息（规范下限 12 字，这里按 30 字提提醒）
 *   2. 缺 readingTips.warning —— 读者不知道这本书有没有需要提前知道的题材
 *   3. 类别与内容不符 —— 标了「短篇集，各篇独立」却没有 series/选集说明，
 *      或标了「系列」却 series 为空
 *   4. 侦探字段与 series 不一致 —— 系列作品却没写主角
 *   5. 标签过少（< 4）—— 推荐时几乎没有可比对的维度
 *
 * 用法：
 *   node scripts/audit-offline.mjs            汇总 + 列出问题
 *   node scripts/audit-offline.mjs --json     机器可读
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { partitionTags } from '../web/js/core/tags.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');
const AS_JSON = process.argv.includes('--json');

const countChars = (s) => [...String(s ?? '')].length;

const books = [];
for (const file of fs.readdirSync(BOOKS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()) {
  const list = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, file), 'utf8'));
  if (!Array.isArray(list)) continue;
  for (const b of list) books.push({ ...b, _file: file });
}

const issues = { thinSummary: [], noWarning: [], seriesNoDetective: [], fewTags: [], shortSummaryHard: [] };

for (const b of books) {
  const len = countChars(b.safeSummary);
  if (len < 12) issues.shortSummaryHard.push({ id: b.id, title: b.title, len });
  else if (len < 30) issues.thinSummary.push({ id: b.id, title: b.title, len });

  if (!String(b.readingTips?.warning ?? '').trim()) {
    issues.noWarning.push({ id: b.id, title: b.title });
  }

  // 「非系列」是占位符（表示这本书不属于任何系列），不该要求写主角
  const series = String(b.series ?? '').trim();
  if (series && series !== '非系列' && !String(b.detective ?? '').trim()) {
    issues.seriesNoDetective.push({ id: b.id, title: b.title, series, _file: b._file });
  }

  const { valid } = partitionTags(b.tags ?? []);
  const total = valid.length + (b.school ?? []).length;
  if (total < 4) issues.fewTags.push({ id: b.id, title: b.title, total, _file: b._file });
}

if (AS_JSON) {
  console.log(JSON.stringify({ total: books.length, issues }, null, 2));
  process.exit(0);
}

const line = (label, arr, hint) => {
  console.log('');
  console.log(`  ${arr.length ? '!' : '✓'} ${label}：${arr.length} 部${arr.length ? `　（${hint}）` : ''}`);
  for (const x of arr.slice(0, 15)) {
    const extra = x.len !== undefined ? `梗概 ${x.len} 字` : x.series ? `系列=${x.series}` : x.total !== undefined ? `标签 ${x.total} 个` : '';
    console.log(`        ${x._file ?? ''}${x.id}  《${x.title}》  ${extra}`);
  }
  if (arr.length > 15) console.log(`        … 另有 ${arr.length - 15} 部`);
};

console.log('');
console.log('  离线质量体检');
console.log('  ────────────────────────────────────────────');
console.log(`  全库 ${books.length} 部（不联网，只查知识库自身）`);
line('梗概不足 12 字（不合规）', issues.shortSummaryHard, '必须补齐');
line('梗概 12–29 字（偏薄）', issues.thinSummary, '信息量可能不足');
line('缺 readingTips.warning', issues.noWarning, '读者无法预知题材');
line('有系列但没写主角', issues.seriesNoDetective, '系列检索与推荐会弱化');
line('标签总数不足 4 个', issues.fewTags, '推荐可比维度太少');
console.log('');
