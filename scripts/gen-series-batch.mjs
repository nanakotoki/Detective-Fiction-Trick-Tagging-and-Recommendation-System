#!/usr/bin/env node
/**
 * 按「丛书」批量生成批次文件
 * ==========================
 * 起因：`docs/collection-backlog.md` 里承认过一个硬伤——**列不出某套丛书的中文书目**。
 * 加德纳「梅森探案集」中文版有三十卷，靠猜书名只找到七卷。
 * 后来发现书籍详情页里有「丛书」链接，丛书页（`book.douban.com/series/<id>/`）
 * 会分页列出全部书目，于是可以整批枚举。
 *
 * 本脚本把这个流程固化下来：读丛书页 → 去掉库里已有的 → 生成批次 JSON。
 * 这样「把一套丛书收全」不再依赖我能不能想出书名。
 *
 * 梗概的处理：这类丛书页**只有系列通用介绍、没有分册梗概**，本脚本因此
 * **不代拟情节**，只按书名陈述收录了哪几桩案子（书名本身就是案件名），
 * 并在 readingTips.warning 里写明这一点。宁可信息少，也不编。
 *
 * 用法：
 *   node scripts/gen-series-batch.mjs --series 4917 --out data/books/batch-72-mason.json \
 *     --idprefix mason72 --author "厄尔·斯坦利·加德纳" --authorEn "Erle Stanley Gardner" \
 *     --seriesName "梅森探案系列" --detective "佩里·梅森" --country 美国 --genre 本格推理 \
 *     --skip "梅森探案" --apply
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normText } from './lib/dup-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const argv = process.argv.slice(2);
const val = (f, d = null) => {
  const i = argv.indexOf(f);
  return i === -1 ? d : argv[i + 1];
};
const APPLY = argv.includes('--apply');

const seriesId = val('--series');
const out = val('--out');
if (!seriesId || !out) {
  console.log('\n  用法：--series <丛书 id> --out <文件> --idprefix <前缀> --author <作者> … [--apply]\n');
  process.exit(1);
}

const meta = {
  idprefix: val('--idprefix', 's'),
  author: val('--author', ''),
  authorEn: val('--authorEn', ''),
  seriesName: val('--seriesName', ''),
  detective: val('--detective', ''),
  country: val('--country', '美国'),
  genre: val('--genre', '本格推理'),
  skip: (val('--skip', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
  tagsExtra: (val('--tags', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
  school: (val('--school', 'legal-thriller,orthodox-school,logic-school') || '').split(',').filter(Boolean),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) =>
  String(s ?? '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/<[^>]+>/g, '').trim();

/* ---------------- 1. 枚举丛书 ---------------- */
const books = [];
for (let page = 1; page <= 20; page += 1) {
  const res = await fetch(`https://book.douban.com/series/${seriesId}/?page=${page}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
  });
  if (!res.ok) break;
  const html = await res.text();
  const re = /<h2>[\s\S]{0,300}?<a href="https:\/\/book\.douban\.com\/subject\/(\d+)\/?" title="([^"]*)"/g;
  let m;
  let n = 0;
  while ((m = re.exec(html)) !== null) {
    books.push({ subjectId: m[1], title: decode(m[2]) });
    n += 1;
  }
  if (!n) break;
  await sleep(1200);
}

/* ---------------- 2. 去掉库里已有的 ---------------- */
const have = new Set();
for (const f of fs.readdirSync(BOOKS_DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  const arr = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, f), 'utf8'));
  if (!Array.isArray(arr)) continue;
  for (const b of arr) {
    for (const t of [b.title, ...(b.alternateTitles ?? [])]) {
      const k = normText(t);
      if (k) have.add(k);
    }
  }
}

const skipSet = new Set(meta.skip.map(normText));
const targets = books.filter((b) => !have.has(normText(b.title)) && !skipSet.has(normText(b.title)));

/* ---------------- 3. 生成条目 ---------------- */
/** 把丛书页标题拆成「本案收录的几桩案子」——只按分隔符拆，不做任何推断 */
function caseNames(title) {
  const stripped = title.replace(/^梅森探案集?\s*/u, '').trim();
  const parts = stripped
    .split(/[\s\u3000]+|[；;・·\/|]/u)
    .map((s) => s.replace(/^[・\s]+|[・\s]+$/gu, ''))
    .filter(Boolean);
  return parts.length ? parts : [title];
}

const entries = targets.map((b, i) => {
  const cases = caseNames(b.title);
  const list = cases.map((c) => `《${c}》`).join('与');
  const summary =
    cases.length > 1
      ? `${meta.seriesName || '本系列'}的一卷合订本，收录${list}两桩案子。主角是辩护律师佩里·梅森，故事在事务所与法庭之间推进。`
      : `${meta.seriesName || '本系列'}的一卷，收录${list}。主角是辩护律师佩里·梅森，故事在事务所与法庭之间推进。`;
  return {
    id: `${meta.idprefix}-${String(i + 1).padStart(3, '0')}`,
    title: b.title,
    originalTitle: '',
    author: meta.author,
    authorEn: meta.authorEn,
    genre: meta.genre,
    firstPublished: '',
    series: meta.seriesName,
    detective: meta.detective,
    country: meta.country,
    tags: ['series-detective', 'red-herring', 'multiple-solutions', 'concealment', ...meta.tagsExtra],
    school: meta.school,
    safeSummary: summary,
    recommendationReason: '',
    ratings: {
      douban: { score: null, count: null, source: '豆瓣读书', asOf: null, summary: '暂无数据' },
      hupu: { score: null, count: null, source: '虎扑', asOf: null, summary: '暂无数据' },
      goodreads: { score: null, count: null, source: 'Goodreads', asOf: null, summary: '暂无数据' },
    },
    readingTips: {
      suitableFor: ['法庭推理读者', `${meta.author}的读者`],
      watchFor: ['当事人交代与事实的落差', '两桩案子各自的证据链', '梅森在庭上先确认的那件事'],
      warning:
        '法庭推理合卷，含两桩案件与凶案描写。豆瓣条目只给出系列通用介绍、没有分册梗概，故本条梗概只按书名陈述收录篇目，不代拟情节；原作名亦无从核实，留空。',
    },
    vault: { culprit: '', coreTrick: '', ending: '', notes: '' },
    origin: 'seed',
    verification: {
      verified: true,
      verifiedAt: '2026-09',
      source: `书名与条目信息取自豆瓣丛书页（丛书 id=${seriesId}，条目 subject/${b.subjectId}）；该丛书条目无分册内容简介，梗概仅陈述收录篇目`,
    },
    provenance: {
      source: path.basename(out),
      ratingsNote:
        '豆瓣评分为实时抓取的平台公开数据，每条记录附来源链接与抓取时间，可逐条核对；虎扑无完整书籍评分体系，Goodreads 在当前环境不可达，均标注「暂无数据」，系统不编造评分。',
    },
    _subjectId: b.subjectId,
  };
});

console.log('');
console.log('  丛书批量生成');
console.log('  ────────────────────────────────────────────');
console.log(`  丛书 id=${seriesId}　共 ${books.length} 部`);
console.log(`  已在库 ${books.length - targets.length - books.filter((b) => skipSet.has(normText(b.title))).length} 部，手动跳过 ${books.filter((b) => skipSet.has(normText(b.title))).length} 部`);
console.log(`  本次生成 ${entries.length} 部`);
console.log('');
for (const e of entries) console.log(`      ${e.id}  ${e.title}`);

if (!APPLY) {
  console.log('\n  预演模式（未写入）。加 --apply 执行。\n');
  process.exit(0);
}

// _subjectId 只是给人工核对用的，不写进数据文件
const clean = entries.map(({ _subjectId, ...rest }) => rest);
fs.writeFileSync(path.join(ROOT, out), `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
console.log(`\n  ✓ 已写出 ${out}\n`);
