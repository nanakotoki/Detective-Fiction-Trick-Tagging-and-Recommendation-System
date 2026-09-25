#!/usr/bin/env node
/**
 * 生成「名单作者收录清单」（可读文档）
 * ==================================
 * 这个项目有一个绕不过去的限制：**无法自动枚举某位作者的全部作品**。
 * 豆瓣的 `subject_suggest` 只按书名检索；传作者名只返回作者节点；
 * `/author/<id>/works` 是 404。所以「这位作者还有没有漏」只能靠人工提供候选书名。
 *
 * 本脚本把这个限制**交给能解决它的人**：把名单上每位作者目前收了哪些书
 * 整理成一份带出版年与评分的清单，你扫一眼就能指出「某某的《XXX》没有」。
 *
 * 输出：docs/名单作者收录清单.md
 *
 * 用法：node scripts/gen-author-report.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normText, AUTHOR_ALIASES } from './lib/dup-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');
const OUT = path.join(ROOT, 'docs', '名单作者收录清单.md');

/* ---------------- 读取名单 ---------------- */
// 结构：{ note, regions: { "0": { region: "中国", authors: [...] }, ... } }
const master = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'authors-master.json'), 'utf8'));
const groups = Object.values(master.regions ?? {});
if (!groups.length) {
  console.error('  ✗ data/authors-master.json 里没有 regions');
  process.exit(1);
}
/** 展平成 { region, authors: [] }，把「其他国家」排到最后 */
const REGION_ORDER = ['中国', '日本', '欧美', '其他国家'];
groups.sort((a, b) => {
  const ia = REGION_ORDER.indexOf(a.region);
  const ib = REGION_ORDER.indexOf(b.region);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
});

/* ---------------- 读取知识库 ---------------- */
const books = [];
for (const file of fs.readdirSync(BOOKS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()) {
  const arr = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, file), 'utf8'));
  if (!Array.isArray(arr)) continue;
  for (const b of arr) books.push(b);
}
const totalAuthors = groups.reduce((n, g) => n + g.authors.length, 0);

/** 作者名归一：去掉 [国别] 前缀、间隔号、空格，再套用异地名表 */
function normAuthor(s) {
  const base = String(s ?? '')
    .replace(/^\[[^\]]*\]\s*/, '')
    .replace(/[\s\u3000·・.]/g, '')
    .replace(/（.*?）|\(.*?\)/g, '')
    .toLowerCase();
  // 复用判重模块的别名表：名单写「杰弗里·迪弗」、库里存「杰夫里·迪弗」，
  // 不归一就会把已收 12 部的作者报成「0 部」。
  return AUTHOR_ALIASES[base] ?? base;
}

/** 名单里可能写成「孙沁文（鸡丁）」，库里是「孙沁文」 */
function matches(listName, bookAuthor) {
  const a = normAuthor(listName);
  const b = normAuthor(bookAuthor);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/* ---------------- 生成 ---------------- */
const lines = [];
lines.push('# 名单作者收录清单');
lines.push('');
lines.push('> 这份清单是**给你核对用的**，不是最终产出。');
lines.push('>');
lines.push('> 起因：本系统**无法自动枚举某位作者的全部作品** —— 豆瓣的检索接口只按书名工作，');
lines.push('> 传作者名只返回一个作者节点，作者页与作品列表接口都取不到。所以「这位作者还有没有漏」');
lines.push('> 只能靠人工提供候选书名。你扫一遍下面这份清单，就能直接指出「某某的《XXX》没有」。');
lines.push('>');
lines.push(`> 生成时间：${new Date().toISOString().slice(0, 10)}　·　知识库 ${books.length} 部　·　名单 ${totalAuthors} 位作者`);
lines.push('>');
lines.push('> 发现缺口后，直接告诉我书名即可；若有豆瓣链接或 ISBN 更准确。');
lines.push('');
lines.push('---');
lines.push('');

const summary = { total: 0, covered: 0, thin: [], missing: [] };

for (const g of groups) {
  lines.push(`## ${g.region}（名单 ${g.authors.length} 位）`);
  lines.push('');
  for (const name of g.authors) {
    summary.total += 1;
    const owned = books
      .filter((b) => matches(name, b.author))
      .sort((x, y) => String(x.firstPublished || '').localeCompare(String(y.firstPublished || '')));
    if (!owned.length) {
      summary.missing.push({ region: g.region, name });
      lines.push(`### ${name} —— **0 部（豆瓣检索不到中文条目）**`);
      lines.push('');
      continue;
    }
    summary.covered += 1;
    if (owned.length < 3) summary.thin.push({ region: g.region, name, n: owned.length });
    const flag = owned.length < 3 ? ' ⚠️ 偏薄' : '';
    lines.push(`### ${name} —— ${owned.length} 部${flag}`);
    lines.push('');
    for (const b of owned) {
      const d = (b.ratings || {}).douban || {};
      const rating = d.score != null ? `${d.score}（${d.count ?? '?'} 人）` : '暂无评分';
      const year = String(b.firstPublished || '').trim() || '—';
      const alt = (b.alternateTitles ?? []).length ? `　又名：${b.alternateTitles.join('、')}` : '';
      lines.push(`- 《${b.title}》　${year}　${rating}　\`${b.id}\`${alt}`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('');
}

lines.push('## 汇总');
lines.push('');
lines.push(`- 名单作者：**${summary.total}** 位`);
lines.push(`- 已有收录：**${summary.covered}** 位`);
lines.push(`- 完全未收（豆瓣查不到中文条目）：**${summary.missing.length}** 位 —— ${summary.missing.map((m) => m.name).join('、') || '（无）'}`);
lines.push(`- 收录不足 3 部的：**${summary.thin.length}** 位`);
lines.push('');
lines.push('| 地区 | 作者 | 在库 |');
lines.push('|------|------|:----:|');
for (const t of summary.thin) lines.push(`| ${t.region} | ${t.name} | ${t.n} |`);
lines.push('');

fs.writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');

console.log('');
console.log('  名单作者收录清单');
console.log('  ────────────────────────────────────────────');
console.log(`  名单 ${summary.total} 位 / 已收 ${summary.covered} 位 / 未收 ${summary.missing.length} 位`);
console.log(`  收录不足 3 部的 ${summary.thin.length} 位`);
console.log('');
console.log(`  ✓ 已写出 ${path.relative(ROOT, OUT)}`);
console.log('');
