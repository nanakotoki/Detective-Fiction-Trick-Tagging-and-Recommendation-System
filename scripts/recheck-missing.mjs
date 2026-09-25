#!/usr/bin/env node
/**
 * 复核「豆瓣检索无结果」的条目
 * ==============================
 * 背景：早前这些条目被判为「豆瓣上没有」，但其中一部分的真实原因是
 * **我们用来检索的中文书名不对**（凭印象拼的译名、繁体/日文写法、
 * 平台用了另一版书名），而不是条目不存在。把"搜不到"当成"不存在"，
 * 是这个项目里出现过的最严重的一类错误。
 *
 * 本脚本对每个未命中的条目尝试多种检索口径，并列出候选，供人工判断：
 *   1. 知识库书名
 *   2. 原书名（日文/英文原名）
 *   3. 书名 + 作者
 *   4. 作者 + 书名关键词
 *   5. 去标点／去虚词的书名
 *
 * 只做检索与报告，**不修改任何数据文件**。
 *
 * 用法：
 *   node scripts/recheck-missing.mjs              # 复核全部未命中条目
 *   node scripts/recheck-missing.mjs --id jpcls-003
 *   node scripts/recheck-missing.mjs --json       # 输出 JSON，便于后续处理
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_FILES } from '../web/js/core/seed-files.js';
import { parseDoubanSuggest } from '../web/js/core/ratings.js';
import { looksLikeDifferentBook } from './refresh-ratings.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ATLAS = path.join(ROOT, 'data', 'ratings-atlas.json');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const onlyId = (() => {
  const i = argv.indexOf('--id');
  return i === -1 ? null : argv[i + 1];
})();
const DELAY = Number((() => {
  const i = argv.indexOf('--delay');
  return i === -1 ? 1200 : argv[i + 1];
})()) || 1200;

const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', green: '\u001b[32m', yellow: '\u001b[33m', cyan: '\u001b[36m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 读出所有种子书 */
function loadBooks() {
  const out = [];
  for (const { file, data } of SEED_FILES) {
    for (const raw of Array.isArray(data) ? data : []) out.push({ ...raw, _file: file });
  }
  return out;
}

/** 已具备可追溯实时记录的 book id */
function liveIds() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ATLAS, 'utf8'));
    const records = Array.isArray(parsed) ? parsed : (parsed.records ?? []);
    return new Set(records.filter((r) => r?.sourceUrl).map((r) => r.id));
  } catch {
    return new Set();
  }
}

/** 构造多种检索口径 */
function queriesFor(book) {
  const title = String(book.title ?? '').trim();
  const author = String(book.author ?? '').trim();
  const orig = String(book.originalTitle ?? '').trim();

  const stripped = title.replace(/[《》〈〉·・:：,，.。、\-—－_/\\|()（）[\]【】「」『』!！?？"'“”‘’]/g, '');
  const noParticle = stripped.replace(/[之的与和]/g, '');

  return [
    title,
    orig,
    `${title} ${author}`,
    `${author} ${noParticle}`,
    noParticle !== stripped ? noParticle : null,
    orig ? `${orig} ${author}` : null,
  ].filter((q, i, arr) => q && arr.indexOf(q) === i);
}

async function suggest(q) {
  const url = `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://book.douban.com/' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseDoubanSuggest(await res.text());
}

async function main() {
  const books = loadBooks();
  const live = liveIds();
  let targets = books.filter((b) => !live.has(b.id));
  if (onlyId) targets = targets.filter((b) => b.id === onlyId);

  if (!AS_JSON) {
    console.log('');
    console.log(color('  复核「豆瓣检索无结果」条目', C.bold));
    console.log(color('  ────────────────────────────────────────────', C.dim));
    console.log(`  待复核 ${targets.length} 部（全库 ${books.length} 部，已有实时记录 ${live.size} 部）`);
    console.log(`  检索间隔 ${DELAY} ms，预计约 ${Math.ceil((targets.length * 5 * DELAY) / 60000)} 分钟`);
    console.log('');
  }

  const results = [];

  for (const [i, book] of targets.entries()) {
    const found = [];
    const seen = new Set();

    for (const q of queriesFor(book)) {
      let list = [];
      try {
        list = await suggest(q);
      } catch {
        /* 网络抖动：跳过该关键词 */
      }
      for (const c of list) {
        if (!c.title || /^\[/.test(String(c.title))) continue; // 跳过作者节点
        if (seen.has(c.id)) continue;
        const verdict = looksLikeDifferentBook(
          { title: c.title, author: c.author_name ?? '' },
          { title: book.title, author: book.author },
        );
        seen.add(c.id);
        found.push({
          query: q,
          title: c.title,
          year: c.year ?? '',
          author: c.author_name ?? '',
          subjectId: c.id,
          url: c.url,
          rejected: verdict.reject === true,
          reason: verdict.reason ?? '',
        });
      }
      await sleep(DELAY);
    }

    // 放行的候选才算「很可能就是它」
    const accepted = found.filter((f) => !f.rejected);
    const rejected = found.filter((f) => f.rejected);

    results.push({
      id: book.id,
      file: book._file,
      title: book.title,
      originalTitle: book.originalTitle ?? '',
      author: book.author,
      country: book.country ?? '',
      accepted,
      rejectedCount: rejected.length,
      rejectedSample: rejected.slice(0, 3),
    });

    if (!AS_JSON) {
      const tag =
        accepted.length > 0
          ? color('✓ 找到可用候选', C.green)
          : found.length > 0
            ? color('? 有条目但被否决', C.yellow)
            : color('✗ 确实无结果', C.dim);
      console.log(`[${String(i + 1).padStart(3)}/${targets.length}] 《${book.title}》（${book.author}） ${tag}`);
      for (const a of accepted.slice(0, 3)) {
        console.log(`        → ${a.title}（${a.year}）${a.author}  [${a.subjectId}]  检索词「${a.query}」`);
      }
      for (const r of rejected.slice(0, 2)) {
        console.log(color(`        · 否决：${r.title}（${r.year}）${r.author} —— ${r.reason}`, C.dim));
      }
    }
  }

  const fixable = results.filter((r) => r.accepted.length > 0);
  const ambiguous = results.filter((r) => r.accepted.length === 0 && r.rejectedCount > 0);
  const truly = results.filter((r) => r.accepted.length === 0 && r.rejectedCount === 0);

  if (AS_JSON) {
    console.log(JSON.stringify({ results, summary: { total: results.length, fixable: fixable.length, ambiguous: ambiguous.length, truly: truly.length } }, null, 2));
    return;
  }

  console.log('');
  console.log(color('  ────────────────────────────────────────────', C.dim));
  console.log(`  ${color('✓ 有可用候选（可以补抓）', C.green)}   ${fixable.length} 部`);
  console.log(`  ${color('? 有条目但被守卫否决', C.yellow)}       ${ambiguous.length} 部`);
  console.log(`  ${color('✗ 多种口径均无结果', C.dim)}           ${truly.length} 部`);
  console.log('');

  if (fixable.length) {
    console.log(color('  可补抓的条目：', C.bold));
    for (const r of fixable) {
      const best = r.accepted[0];
      console.log(`    ${r.id.padEnd(14)} 《${r.title}》 → 《${best.title}》（${best.year}）[${best.subjectId}]`);
    }
    console.log('');
  }
  if (ambiguous.length) {
    console.log(color('  需人工判断（候选被守卫否决，可能确实是另一本书）：', C.bold));
    for (const r of ambiguous) {
      console.log(`    ${r.id.padEnd(14)} 《${r.title}》 —— 否决 ${r.rejectedCount} 条，例：${r.rejectedSample[0]?.title ?? ''}`);
    }
    console.log('');
  }
}

main().catch((e) => {
  console.error(color(`\n✗ 复核脚本异常：${e.stack ?? e.message}\n`, C.reset));
  process.exit(1);
});
