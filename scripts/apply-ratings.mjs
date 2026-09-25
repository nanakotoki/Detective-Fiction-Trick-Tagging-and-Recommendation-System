#!/usr/bin/env node
/**
 * 把实时抓取结果写回知识库
 * ==========================
 * 读取 `data/ratings-atlas.json`（由 refresh-ratings.mjs 生成），把其中的**实时评分**
 * 合并进 `data/books/*.json`，同时保留来源链接与抓取时间。
 *
 * 合并规则（只动评分相关字段，绝不触碰标签、简介、阅读提示等内容）：
 *   score / count        ← 实时值
 *   sourceUrl            ← 来源链接（新增，供读者核对）
 *   fetchedAt            ← 抓取时间（新增）
 *   asOf                 ← 抓取月份
 *   edition              ← 所采用的版本（新增，豆瓣同书多版本，必须说明用的是哪版）
 *   summary              ← **保留原有去剧透摘要**（实时抓取不碰书评正文，避免引入剧透）
 *   provenance.ratingsNote ← 更新为如实说明
 *
 * 用法：
 *   node scripts/apply-ratings.mjs             预演，只打印将要发生的变更
 *   node scripts/apply-ratings.mjs --apply     实际写回
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateRating } from '../web/js/core/ratings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');
const ATLAS = path.join(ROOT, 'data', 'ratings-atlas.json');

const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m', cyan: '\u001b[36m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

const APPLY = process.argv.includes('--apply');

const NOTE_LIVE =
  '豆瓣评分为实时抓取的平台公开数据，每条记录附来源链接与抓取时间，可逐条核对；' +
  '虎扑无完整书籍评分体系，Goodreads 在当前环境不可达，均标注「暂无数据」，系统不编造评分。';

async function main() {
  console.log('');
  console.log(color('  把实时评分写回知识库', C.bold));
  console.log(color('  ────────────────────────────────────────────', C.dim));
  console.log(`  模式：${APPLY ? color('写回文件 (--apply)', C.yellow) : '预演（不修改文件）'}`);
  console.log('');

  let atlas;
  try {
    atlas = JSON.parse(await fs.readFile(ATLAS, 'utf8'));
  } catch (error) {
    console.log(color(`  ✗ 无法读取 data/ratings-atlas.json：${error.message}`, C.red));
    console.log(color('    请先运行：node scripts/refresh-ratings.mjs', C.dim));
    console.log('');
    process.exit(1);
  }

  const records = Array.isArray(atlas) ? atlas : (atlas.records ?? []);
  if (!records.length) {
    console.log(color('  ! 图谱中没有记录', C.yellow));
    process.exit(0);
  }

  // 只保留通过校验、可追溯的记录
  const usable = new Map();
  const rejected = [];
  for (const record of records) {
    const check = validateRating(record.platform, record);
    if (!check.ok) {
      rejected.push({ record, reasons: check.reasons });
      continue;
    }
    usable.set(`${record.id}::${record.platform}`, record);
  }

  console.log(`  图谱记录   ${records.length} 条（可用 ${usable.length} 条，被拒 ${rejected.length} 条）`);
  if (rejected.length) {
    for (const r of rejected.slice(0, 10)) {
      console.log(color(`    ✗ 《${r.record.title}》—— ${r.reasons.join('；')}`, C.red));
    }
  }
  console.log('');

  const files = (await fs.readdir(BOOKS_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
  const changes = [];
  const touchedFiles = new Set();

  for (const file of files) {
    const fullPath = path.join(BOOKS_DIR, file);
    let list;
    try {
      list = JSON.parse(await fs.readFile(fullPath, 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(list)) continue;

    let dirty = false;

    for (const book of list) {
      const record = usable.get(`${book.id}::douban`);
      if (!record) continue;

      const current = book.ratings?.douban ?? {};
      const sameScore = current.score === record.score && current.count === record.count;
      if (sameScore && current.sourceUrl === record.sourceUrl) continue;

      changes.push({
        file,
        id: book.id,
        title: book.title,
        from: current.score ?? null,
        fromCount: current.count ?? null,
        to: record.score,
        toCount: record.count,
        edition: `${record.editionTitle ?? book.title}${record.editionYear ? ` ${record.editionYear}` : ''}`,
        lowSample: record.lowSample === true,
      });

      if (!APPLY) continue;

      book.ratings = book.ratings ?? {};
      book.ratings.douban = {
        // 保留原有的去剧透评价摘要——实时抓取不读取书评正文
        summary: current.summary && current.summary !== '暂无数据' ? current.summary : '暂无数据',
        score: record.score,
        count: record.count ?? null,
        scale: '10 分制',
        source: '豆瓣读书（实时抓取）',
        sourceUrl: record.sourceUrl,
        subjectId: record.subjectId ?? null,
        edition: record.editionTitle ? `${record.editionTitle}${record.editionYear ? ` ${record.editionYear}` : ''}` : null,
        fetchedAt: record.fetchedAt,
        asOf: record.asOf,
      };

      book.provenance = {
        ...(book.provenance ?? {}),
        source: book.provenance?.source ?? file,
        ratingsNote: NOTE_LIVE,
      };

      dirty = true;
    }

    if (APPLY && dirty) {
      await fs.writeFile(fullPath, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
      touchedFiles.add(file);
    }
  }

  /* ---------------- 汇总 ---------------- */
  console.log(color('  变更明细', C.bold));
  if (!changes.length) {
    console.log('    没有需要变更的条目');
  }
  for (const c of changes.slice(0, 60)) {
    const delta = c.from === null ? '' : ` (Δ${(c.to - c.from).toFixed(1)})`;
    console.log(
      `    ${c.id.padEnd(16)} 《${c.title}》  ${String(c.from ?? '暂无').padStart(4)} → ${String(c.to).padStart(4)}${delta}` +
        color(`   ${c.edition}`, C.dim) +
        (c.lowSample ? color('  ⚠ 样本偏少', C.yellow) : ''),
    );
  }
  if (changes.length > 60) console.log(color(`    … 另有 ${changes.length - 60} 条`, C.dim));

  console.log('');
  console.log(`  变更总数   ${changes.length} 条，涉及 ${new Set(changes.map((c) => c.file)).size} 个数据文件`);
  const lowSample = changes.filter((c) => c.lowSample);
  if (lowSample.length) {
    console.log(color(`  ! 其中 ${lowSample.length} 条评价人数偏少（<200），分数稳定性较差`, C.yellow));
  }

  if (APPLY) {
    console.log('');
    console.log(color(`  ✓ 已写回 ${touchedFiles.size} 个文件`, C.green + C.bold));
    console.log(color('    建议接着运行：node scripts/check-data.mjs && node scripts/build.mjs', C.dim));
  } else if (changes.length) {
    console.log('');
    console.log(color('  这是预演。确认无误后加 --apply 实际写回。', C.yellow));
  }
  console.log('');
}

main().catch((error) => {
  console.error(color(`\n✗ 写回脚本异常：${error.stack ?? error.message}\n`, C.red));
  process.exit(1);
});
