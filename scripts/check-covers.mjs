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
}

/* ---------------- 汇总 ---------------- */

const pct = books.length ? ((withCover / books.length) * 100).toFixed(1) : '0.0';
log(`  作品总数 ${books.length} 部 ｜ 有封面 ${withCover} 部（${pct}%）｜ 未取到 ${Object.keys(misses).length} 部`);
log(`  图片体积合计 ${(bytes / 1024 / 1024).toFixed(1)}MB ｜ 来源分布 ${JSON.stringify(bySource)}`);
if (withCover) log(`  平均每张 ${(bytes / withCover / 1024).toFixed(1)}KB`);

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
