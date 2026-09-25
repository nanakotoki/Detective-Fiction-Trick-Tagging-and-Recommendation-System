#!/usr/bin/env node
/**
 * 推荐质量抽查（维护工具）
 * ========================
 * 对若干代表作跑一遍推荐，把结果打印出来供人工核对。
 * 每次改动标签数据、权重或算法后，建议跑一次确认结果仍然合理。
 *
 * 用法：
 *   node scripts/preview-recommendations.mjs                     使用内置探针书单
 *   node scripts/preview-recommendations.mjs 无人生还 罗杰疑案    指定书名
 *   node scripts/preview-recommendations.mjs --full               同时打印完整 Markdown 报告
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG, bookTagIds, findBackgroundTags, recommend } from '../web/js/core/engine.js';
import { tagLabel } from '../web/js/core/tags.js';
import { normalizeSeedBook } from '../web/js/core/seed.js';
import { analyzeBook } from '../web/js/core/safety.js';
import { renderReport } from '../web/js/core/report.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');

const DEFAULT_PROBES = ['无人生还', '嫌疑人X的献身', '罗杰疑案', '点与线', '狱门岛', '长夜难明', '喜鹊谋杀案', '钟表馆事件'];

const argv = process.argv.slice(2);
const FULL = argv.includes('--full');
const probes = argv.filter((a) => !a.startsWith('--'));
const PROBES = probes.length ? probes : DEFAULT_PROBES;

/* ------------------------------------------------------------------ */

function loadBooks() {
  const books = [];
  for (const file of fs
    .readdirSync(BOOKS_DIR)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .sort()) {
    let list;
    try {
      list = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, file), 'utf8'));
    } catch (error) {
      console.warn(`！跳过 ${file}：${error.message}`);
      continue;
    }
    if (!Array.isArray(list)) {
      console.warn(`！跳过 ${file}：顶层不是数组`);
      continue;
    }
    for (const item of list) {
      const book = normalizeSeedBook(item, null, file);
      if (book) books.push(book);
    }
  }
  return books;
}

function main() {
  const books = loadBooks();
  const background = findBackgroundTags(books);

  console.log('');
  console.log(`  知识库 ${books.length} 部作品`);
  console.log(`  背景标签（出现频率 > ${String(DEFAULT_CONFIG.backgroundTagRatio * 100)}%，不参与杰卡德计算）：`);
  console.log(`    ${[...background].map(tagLabel).join('、') || '无'}`);
  console.log(`  领域约束：诡计类零重合的候选默认排除（requireTrickOverlap = ${String(DEFAULT_CONFIG.requireTrickOverlap)}）`);
  console.log(
    `    例外：目标作品自身没有诡计类标签时放宽（relaxTrickOverlapWhenUntagged = ${String(
      DEFAULT_CONFIG.relaxTrickOverlapWhenUntagged,
    )}），并如实标注"本次推荐不含诡计维度"`,
  );

  let missing = 0;

  for (const title of PROBES) {
    const target = books.find((b) => b.title === title || b.title.includes(title));
    if (!target) {
      console.log(`\n！知识库中没有《${title}》`);
      missing += 1;
      continue;
    }

    const result = recommend(target, books, { limit: 3 });
    const ownTags = bookTagIds(target).filter((id) => tagLabel(id));

    console.log('');
    console.log('─'.repeat(80));
    console.log(`《${target.title}》— ${target.author}   共 ${ownTags.length} 个标签，排除 ${result.excluded.length} 部候选`);
    if (result.trickGate?.relaxed) {
      console.log(`  ⓘ ${result.trickGate.note}`);
    }

    if (!result.recommendations.length) {
      console.log('  ⚠ 无推荐结果——请检查该作品的诡计类标签是否过于冷门');
    }

    for (const [i, rec] of result.recommendations.entries()) {
      console.log(`  ${i + 1}. 《${rec.book.title}》— ${rec.book.author}   ${String(rec.percent)}%  [${rec.confidence.label}]`);
      console.log(`     共享标签：${rec.detail.matched.map(tagLabel).join('、')}`);
      console.log(`     共享诡计：${rec.detail.trickMatched.map(tagLabel).join('、') || '无'}`);
      console.log(`     匹配理由：${rec.reason}`);
      console.log(`     反剧透校验：${rec.safety.passed ? '通过' : '未通过 ✗'}`);
    }

    if (FULL) {
      const md = renderReport({ book: target, recommendations: result.recommendations });
      console.log('');
      console.log(md.split('\n').map((l) => `  │ ${l}`).join('\n'));
    }
  }

  /* ---------------- 全库反剧透复检 ---------------- */
  const failing = books.filter((b) => !analyzeBook(b).passed);

  console.log('');
  console.log('─'.repeat(80));
  console.log(`  全库反剧透复检：${books.length - failing.length} / ${books.length} 通过`);
  for (const book of failing) {
    console.log(`    ✗ 《${book.title}》`);
    for (const issue of analyzeBook(book).issues) {
      console.log(`        [${issue.risk}] ${issue.fieldLabel ?? issue.field}：${issue.excerpt}`);
    }
  }
  if (missing) console.log(`\n  （${missing} 本探针书不在知识库中，已跳过）`);
  console.log('');

  process.exit(failing.length ? 1 : 0);
}

main();
