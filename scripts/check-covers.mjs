#!/usr/bin/env node
/**
 * 封面闸门（第 166 轮新增）
 * ========================
 * 封面是**图片文件**，不进 `check-data` 的字段校验范围，所以它需要自己的一道闸门。
 * 这里查的是五件**会静默出错**的事：
 *
 *   1. **台账指向的文件不在盘上** —— 索引说「这部有封面」，页面就会去加载，结果是 404；
 *   2. **盘上有文件但台账没记** —— 孤儿图片：占了仓库体积，却没人知道它从哪来；
 *   3. **图片不是图片**（或小到不可能是封面）—— 抓取时被错误页面/防盗链响应顶替；
 *   4. **强链接对不上号**：索引写着「与评分取自同一条豆瓣条目」，但该条书的
 *      `ratings.douban.subjectId` 与封面记录的条目 id 不是一个 —— 那说明配错了版本，
 *      这正是本项目「评分必须与所引版本同一条」那条规矩在封面上的延伸；
 *   5. **前端清单过期**：`web/js/core/covers.js` 没跟着 `data/covers.json` 重生成，
 *      表现是「明明抓到了封面，页面上还是占位图」。
 *
 * 覆盖率高不高**不是**失败条件——抓不到的用占位图是既定设计，这里只把它打印出来。
 *
 * 用法：node scripts/check-covers.mjs [--quiet]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { coverCodeOf } from './lib/covers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');
const COVERS_DIR = path.join(ROOT, 'web', 'covers');
const INDEX_FILE = path.join(ROOT, 'data', 'covers.json');
const MANIFEST_FILE = path.join(ROOT, 'web', 'js', 'core', 'covers.js');
const PLACEHOLDER = path.join(COVERS_DIR, '_placeholder.svg');

const QUIET = process.argv.includes('--quiet');
const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));
const log = (...a) => {
  if (!QUIET) console.log(...a);
};

/** 图片魔数：JPEG / WebP / PNG 三种够用 */
function sniff(buf) {
  if (!buf || buf.length < 16) return '';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'png';
  return '';
}

const problems = [];
const add = (kind, detail) => problems.push({ kind, detail });

/* ---------------- 读数据 ---------------- */

const books = [];
for (const file of fs.readdirSync(BOOKS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'))) {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, file), 'utf8'));
    if (Array.isArray(list)) for (const b of list) books.push(b);
  } catch {
    /* 坏文件由 check-data 负责报，这里不重复 */
  }
}
const bookById = new Map(books.map((b) => [b.id, b]));

let index = null;
try {
  index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
} catch {
  console.log(color('  ✗ 读不到 data/covers.json（先跑 node scripts/fetch-covers.mjs）', C.red));
  process.exit(1);
}
const records = index.records || {};
const misses = index.misses || {};

log('');
log(color('  封面闸门', C.bold));
log(color('  ────────────────────────────────────────────', C.dim));

/* ---------------- 1~3：文件与台账对照 ---------------- */

const referenced = new Set();
let bytes = 0;
let bySource = {};
/** 台账条数（下面第 5 段要用，须在清单检查之前先算出来） */
const withCover = Object.keys(records).length;
let editionTotal = 0;
let multiEdition = 0;
let editionBytes = 0;
/** 保存了多少个「非主图」的版本封面（它们也要算进仓库体积） */
let extraEditionFiles = 0;
/** 只存链接、不落盘的版本（微信读书） */
let remoteEditions = 0;
for (const [id, rec] of Object.entries(records)) {
  referenced.add(rec.file);
  const full = path.join(COVERS_DIR, rec.file || '');
  if (!rec.file) {
    add('台账无文件名', id);
    continue;
  }
  if (!fs.existsSync(full)) {
    add('台账指向的图片不在盘上', `${id} → ${rec.file}`);
    continue;
  }
  const buf = fs.readFileSync(full);
  bytes += buf.length;
  const kind = sniff(buf);
  if (!kind) {
    add('文件不是图片', `${id} → ${rec.file}`);
    continue;
  }
  if (buf.length < 1024) add('图片过小（疑似错误响应被存了下来）', `${id} → ${rec.file} ${buf.length}B`);
  bySource[rec.source || '?'] = (bySource[rec.source || '?'] || 0) + 1;

  if (!bookById.has(id)) {
    add('封面所属的作品已不在库里', id);
    continue;
  }
  // 4. 强链接必须与取评分的那条条目一致。
  //    注意 `subject-id-miss+…` 不是强链接：那是「检索里没有评分那条条目，改用同名候选」，
  //    按弱链接记账（清单里标 W／T），不参与这条比对。
  if (rec.matched === 'subject-id' || rec.matched === 'subject-id+page') {
    const want = String(bookById.get(id).ratings?.douban?.subjectId || '');
    if (want && String(rec.subjectId || '') !== want) {
      add('强链接与评分条目不一致', `${id}：封面条目 ${rec.subjectId} ≠ 评分条目 ${want}`);
    }
  }
  // 4b. 书号通道取的封面，其 ISBN 必须真的出现在该条的著录里（否则等于配错了版）
  if (rec.matched === 'isbn') {
    const src = String(bookById.get(id).verification?.source || '').replace(/[^\dXx]/g, '');
    if (!rec.isbn) add('书号通道的记录没留 ISBN', id);
    else if (!src.includes(rec.isbn)) add('书号通道的 ISBN 不在该条著录里', `${id}：${rec.isbn}`);
  }

  /* ---------------- 多版本（第 169 轮） ---------------- */

  const eds = rec.editions;
  if (!Array.isArray(eds) || !eds.length) {
    add('记录没有多版本结构（跑 --seed-editions 迁移）', id);
    continue;
  }
  editionTotal += eds.length;
  if (eds.length > 1) multiEdition += 1;
  if (eds.length > 3) add('保存的版本超过上限 3', `${id}：${eds.length} 个`);
  if (eds[0].file !== rec.file || eds[0].primary !== true) {
    add('主图与版本清单的第一条不一致', `${id}：record.file=${rec.file}，editions[0].file=${eds[0].file}`);
  }
  if (eds.filter((e) => e.primary).length !== 1) add('primary 标记不唯一', id);
  for (const e of eds) {
    if (!e.file) {
      /**
       * 只存链接的版本（`remote: true`，目前来自微信读书）：它们的封面在对方 CDN 上**按需加载**，
       * 本地没有文件——所以这里只查「有没有链接」，不查文件。
       * 这一条是有意的取舍：微信读书的 CDN 允许直接外链（实测无 referer 也 200），
       * 把几百 MB 的电子版封面搬进仓库不划算。
       */
      if (e.remote && e.pic) {
        remoteEditions += 1;
        continue;
      }
      add('版本既没有本地文件也没有外链', `${id} / ${e.subjectId || '?'}`);
      continue;
    }
    referenced.add(e.file);
    const full2 = path.join(COVERS_DIR, e.file);
    if (!fs.existsSync(full2)) {
      add('版本图片不在盘上', `${id} → ${e.file}`);
      continue;
    }
    if (e.file !== rec.file) {
      extraEditionFiles += 1;
      editionBytes += fs.statSync(full2).size;
      // 其他版本的文件名约定：`<作品 id>-<豆瓣条目 id>.webp`
      if (e.subjectId && e.file !== `${id}-${e.subjectId}.webp`) {
        add('其他版本的文件名不符合约定', `${id} → ${e.file}（应为 ${id}-${e.subjectId}.webp）`);
      }
    }
    if (!sniff(fs.readFileSync(full2))) add('版本文件不是图片', `${id} → ${e.file}`);
  }
}

const dirFiles = fs.readdirSync(COVERS_DIR).filter((f) => f !== '_placeholder.svg');
for (const f of dirFiles) {
  if (!referenced.has(f)) add('孤儿图片（台账里没有）', f);
}
for (const id of Object.keys(misses)) {
  if (records[id]) add('既在封面台账又在未取到清单里', id);
}
if (!fs.existsSync(PLACEHOLDER)) add('缺占位图', path.relative(ROOT, PLACEHOLDER));

/* ---------------- 5：前端清单是否过期 ---------------- */

let manifest = null;
try {
  manifest = await import(pathToFileURL(MANIFEST_FILE).href);
} catch (error) {
  add('前端清单无法加载', error.message);
}
if (manifest) {
  // 清单是「生成那一刻的快照」：它比台账旧，就说明台账之后又抓到了新封面却没重新生成
  const mAt = Date.parse(manifest.COVER_STATS?.generatedAt || 0);
  const iAt = Date.parse(index.generatedAt || 0);
  if (mAt < iAt) {
    add(
      '前端清单比台账旧',
      `清单 ${manifest.COVER_STATS?.generatedAt || '—'} ＜ 台账 ${index.generatedAt || '—'}；跑 node scripts/gen-cover-manifest.mjs`
    );
  }
  const notInManifest = Object.keys(records).filter((id) => !manifest.hasCover(id));
  if (notInManifest.length) {
    add('有封面但前端清单里没有', `${notInManifest.length} 条，例如 ${notInManifest.slice(0, 5).join('、')}`);
  }
  const manifestCount = books.filter((b) => manifest.hasCover(b.id)).length;
  if (manifestCount !== withCover) {
    add('前端清单与台账条数不一致', `清单 ${manifestCount} 条（且都在库内）／台账 ${withCover} 条`);
  }
  /**
   * 判据码必须与台账对得上。
   *
   * 这一条是 2026-10-03 补的：版本一览那两轮写下的 `editions+works` / `editions+weread`
   * 当时不在映射表里，被兜底成 W（弱链接），全库 2485 部书的档案页把自己的强判据说成了弱链接。
   * 光看条数一致是发现不了的——**「对齐了但说错了」也算错**，所以这里逐条查判据码。
   */
  let codeMismatch = 0;
  const codeSamples = [];
  for (const [id, rec] of Object.entries(records)) {
    if (!manifest.hasCover(id)) continue;
    const credit = manifest.coverCredit(id);
    if (!credit) continue;
    const want = coverCodeOf(rec);
    if (credit.code !== want) {
      codeMismatch += 1;
      if (codeSamples.length < 5) codeSamples.push(`${id}：清单 ${credit.code} ／ 台账 ${rec.matched}→${want}`);
    }
  }
  if (codeMismatch) {
    add('前端判据码与台账不一致', `${codeMismatch} 条，例如 ${codeSamples.join('；')}`);
  }
}

/* ---------------- 6：多版本清单（data/covers-editions.json） ---------------- */

const EDITIONS_FILE = path.join(ROOT, 'data', 'covers-editions.json');
let editionsData = null;
try {
  editionsData = JSON.parse(fs.readFileSync(EDITIONS_FILE, 'utf8'));
} catch {
  add('读不到 data/covers-editions.json（跑 node scripts/gen-cover-manifest.mjs）', '');
}
if (editionsData) {
  const listed = editionsData.books || {};
  const ids = Object.keys(listed);
  const withEds = Object.keys(records).filter((id) => records[id].editions?.length);
  if (ids.length !== withEds.length) {
    add('多版本清单与台账条数不一致', `清单 ${ids.length} 部 ／ 台账 ${withEds.length} 部`);
  }
  for (const id of ids) {
    const rec = records[id];
    if (!rec) {
      add('多版本清单里有台账中没有的作品', id);
      continue;
    }
    const first = listed[id][0];
    if (!first || first.file !== rec.file) {
      add('多版本清单的主图与台账不一致', `${id}：清单 ${first?.file || '—'} ／ 台账 ${rec.file}`);
    }
    for (const e of listed[id]) {
      // 只存链接的版本没有本地文件，跳过文件检查
      if (e.remote) continue;
      if (!fs.existsSync(path.join(COVERS_DIR, e.file || ''))) {
        add('多版本清单指向的图片不在盘上', `${id} → ${e.file}`);
      }
    }
  }
}

/* ---------------- 汇总 ---------------- */

const pct = books.length ? ((withCover / books.length) * 100).toFixed(1) : '0.0';
log(`  作品总数 ${books.length} 部 ｜ 有封面 ${withCover} 部（${pct}%）｜ 未取到 ${Object.keys(misses).length} 部`);
log(`  图片体积合计 ${(bytes / 1024 / 1024).toFixed(1)}MB ｜ 来源分布 ${JSON.stringify(bySource)}`);
if (withCover) log(`  平均每张 ${(bytes / withCover / 1024).toFixed(1)}KB`);
log(
  `  版本一览：${editionTotal} 条版本记录（${multiEdition} 部有 2 个以上版本）｜` +
    ` 本地其他版本 ${extraEditionFiles} 张、${(editionBytes / 1024 / 1024).toFixed(1)}MB` +
    `${remoteEditions ? `｜只存链接的版本 ${remoteEditions} 条（微信读书，按需加载）` : ''}`,
);

if (problems.length) {
  log('');
  log(color(`  ✗ 发现 ${problems.length} 个问题`, C.red));
  for (const p of problems.slice(0, 40)) log(color(`    ✗ [${p.kind}] ${p.detail}`, C.red));
  if (problems.length > 40) log(color(`    … 其余 ${problems.length - 40} 条省略`, C.dim));
  log('');
  process.exit(1);
}

log('');
log(color('  ✓ 封面台账、图片文件与前端清单三者一致', C.green));
log('');
