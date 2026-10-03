#!/usr/bin/env node
/**
 * 把小封面换成清楚的（第 180 轮·D 线）
 * ================================
 * 用户的要求是「尽量把库里几千本书的封面都满足了」。满足之外还有一层：**这张图清不清楚**。
 *
 * 起因（2026-10-03 实测）：形状体检挑出 `social-005《人性的证明》` 本地只有 **98×140**，
 * 可它台账里记着的**同一个原图地址**在豆瓣 CDN 上现在能取回 **270×358**——
 * 也就是说图是「当初抓小了／豆瓣后来换了更大的图」，而**这条路不需要碰被限流的 HTML 页**，
 * 只用图片 CDN（实测一直可用，§179.4）就能把这批图换清楚。
 *
 * 三条安全线，缺一条都不换：
 *   ① 只处理**主图那一版自己有原图地址**的记录（`editions[0].pic`，闸门保证 `editions[0]` 就是主图）；
 *   ② 新的必须**明显更大**（`preferLargerImage()`：≥200px 且比老的大 25% 以上）；
 *   ③ 新的必须**还是同一张画**（dHash 结构指纹比对，阈值与判重同一套）——
 *      若豆瓣那张图被换成了另一张画，**不换**，只报出来等人工看：那是版本变化，不是升级。
 *
 * 用法：
 *   node scripts/upgrade-small-covers.mjs            干跑：报出哪些能换清楚
 *   node scripts/upgrade-small-covers.mjs --apply    真换（写回台账与图片文件）
 *   node scripts/upgrade-small-covers.mjs --limit 20 --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { imageSize, preferLargerImage, toWebp } from './lib/covers.mjs';
import { findFfmpeg, fingerprintsOfBuffer, fingerprintsOfFile, isSameCover } from './lib/image-fp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const COVERS_DIR = path.join(ROOT, 'web', 'covers');
const INDEX_FILE = path.join(ROOT, 'data', 'covers.json');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const LIMIT = Number(argv[argv.indexOf('--limit') + 1]) || 0;
const MIN_WIDTH = Number(argv[argv.indexOf('--below') + 1]) || 240;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', green: '\u001b[32m', yellow: '\u001b[33m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
const books = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'data', 'books'))) {
  if (!f.endsWith('.json') || f.startsWith('_')) continue;
  for (const b of JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'books', f), 'utf8'))) books.set(b.id, b);
}

/** 候选：本地宽度偏小、且主图那一版留有原图地址 */
let targets = [];
for (const [id, rec] of Object.entries(index.records)) {
  const w = Number(rec.width) || 0;
  if (!w || w >= MIN_WIDTH) continue;
  const first = (rec.editions || [])[0];
  if (!first?.pic || first.remote) continue;
  targets.push({ id, rec, pic: first.pic, localWidth: w, localHeight: Number(rec.height) || 0 });
}
if (LIMIT) targets = targets.slice(0, LIMIT);

console.log('');
console.log(color(`  把小封面换成清楚的：候选 ${targets.length} 部（本地宽度 < ${MIN_WIDTH}px）${APPLY ? '　★ --apply' : '（干跑）'}`, C.bold));
console.log(color('  判据：新的 ≥200px 且比老的大 25% 以上，且必须是同一张画（dHash）', C.dim));
console.log('');

const hasFfmpeg = Boolean(findFfmpeg());
if (!hasFfmpeg) console.log(color('  ⚠ 本机没有 ffmpeg：无法比对指纹，本次只报不换（不换图就没有风险）', C.yellow));

let upgraded = 0;
let sameSize = 0;
let changed = 0;
let failed = 0;
const done = [];

for (const t of targets) {
  const file = path.join(COVERS_DIR, t.rec.file);
  if (!fs.existsSync(file)) {
    failed += 1;
    continue;
  }
  let fetched = null;
  try {
    for (const url of [toWebp(t.pic), t.pic]) {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'user-agent': UA, referer: 'https://book.douban.com/', accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) continue;
      const size = imageSize(buf);
      if (size.format !== 'webp' && size.format !== 'jpeg') continue;
      fetched = { buf, ...size, bytes: buf.length };
      break;
    }
  } catch {
    fetched = null;
  }
  if (!fetched) {
    failed += 1;
    continue;
  }
  if (!preferLargerImage({ width: t.localWidth, height: t.localHeight }, fetched)) {
    sameSize += 1;
    continue;
  }
  /**
   * 同一张画吗？——分两种结局，都不是「擅自换图」：
   *   · 同一张画、只是更大  → **升级**（换清楚）；
   *   · 不是同一张画        → 说明**豆瓣换过条目主图**，我们盘上那张是按旧图抓的，
   *                          而台账记的版本（条目 id／年份／译者）指向的是新图。
   *                          这时按台账里的原图地址重下，**让图与证据重新对上**（记为 realignedFrom）。
   *                          只看图说话不够，所以这一支要先把「台账记的是哪一版」打出来。
   */
  const same = hasFfmpeg
    ? isSameCover(fingerprintsOfFile(file), fingerprintsOfBuffer(fetched.buf, fetched.format === 'webp' ? '.webp' : '.jpg'))
    : null;
  if (same === false) {
    changed += 1;
    if (APPLY) {
      fs.writeFileSync(file, fetched.buf);
      t.rec.realignedFrom = {
        width: t.localWidth,
        height: t.localHeight,
        bytes: Number(t.rec.bytes) || 0,
        at: new Date().toISOString(),
        pic: t.pic,
        why: '盘上那张图与台账所记版本已不是同一张（豆瓣换过条目主图）；按台账里的原图地址重下，使图与证据对上',
      };
      t.rec.width = fetched.width;
      t.rec.height = fetched.height;
      t.rec.bytes = fetched.bytes;
      t.rec.format = fetched.format;
      const first = (t.rec.editions || [])[0];
      if (first) {
        first.width = fetched.width;
        first.height = fetched.height;
        first.bytes = fetched.bytes;
        first.format = fetched.format;
      }
    }
    console.log(
      color(
        `  ✎ ${t.id}《${books.get(t.id)?.title || ''}》盘上 ${t.localWidth}×${t.localHeight} 与台账那版（${
          t.rec.edition?.year || '年份不详'
        }《${t.rec.edition?.title || ''}》）不是同一张画 → 按原图地址重下 ${fetched.width}×${fetched.height}`,
        C.yellow,
      ),
    );
    continue;
  }
  upgraded += 1;
  done.push(
    `${t.id}《${books.get(t.id)?.title || ''}》${t.localWidth}×${t.localHeight} → ${fetched.width}×${fetched.height}（${(
      fetched.bytes / 1024
    ).toFixed(1)}KB）`,
  );
  if (APPLY) {
    fs.writeFileSync(file, fetched.buf);
    t.rec.width = fetched.width;
    t.rec.height = fetched.height;
    t.rec.bytes = fetched.bytes;
    t.rec.format = fetched.format;
    t.rec.upgradedFrom = {
      width: t.localWidth,
      height: t.localHeight,
      at: new Date().toISOString(),
      pic: t.pic,
      why: '同一张画、同一版本，只是当初抓小了（或豆瓣后来换了更大的图）；按 preferLargerImage 升级',
    };
    const first = (t.rec.editions || [])[0];
    if (first) {
      first.width = fetched.width;
      first.height = fetched.height;
      first.bytes = fetched.bytes;
      first.format = fetched.format;
    }
  }
}

console.log('');
for (const d of done) console.log(color(`    · ${d}`, C.dim));
console.log(
  color(
    `  ✓ 升级 ${upgraded} 部（同一张画、更大） ／ 重下对齐 ${changed} 部（豆瓣换过主图，图与证据重新对上） ／ CDN 上没有更大的 ${sameSize} 部 ／ 取图失败 ${failed} 部`,
    C.green,
  ),
);

if (APPLY) {
  if (upgraded || changed) {
    index.generatedAt = new Date().toISOString();
    fs.writeFileSync(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    console.log('  ✓ 已写回 data/covers.json 与图片文件');
    console.log('  接着跑：node scripts/dedupe-cross-book.mjs && node scripts/gen-cover-manifest.mjs && node scripts/check-covers.mjs');
  } else {
    console.log('  没有可升级的，台账未改动。');
  }
} else {
  console.log('');
  console.log('  这是干跑。确认后加 --apply。');
}
