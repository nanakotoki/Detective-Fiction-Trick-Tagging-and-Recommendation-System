#!/usr/bin/env node
/**
 * 版本封面去重（第 171 轮）
 * ========================
 * 起因是用户的一句反馈：**「有些你放了两个版本的图片，但事实上他们的图是一模一样的。」**
 *
 * 为什么会这样：多版本是从两个平台拼起来的（豆瓣 + 微信读书），
 * 而**同一部作品的同一张封面**在两边常常同时存在——豆瓣那张带白边与书脊，
 * 微信读书那张是紧裁的电子版封面，看着不同、其实是同一张画。
 * 只按「题名 + 出版社」判重挡不住这种（《狱门岛》与《金田一探案集03：狱门岛》就是同一版）。
 *
 * 所以这里**看图**：把每张封面解码成 16×16 灰度的**结构指纹**（dHash，取整图／裁 90%／裁 80% 三档里最像的一组），
 * 与主图比；判为同一张的版本从 `editions` 里撤下，并把它记进 `editionsDropped`（留痕，可回滚）。
 *
 * **没有 ffmpeg 时本脚本什么都不做**（打印一行说明就退出）——
 * 宁可保留重复，也不要在没有依据的情况下删版本。
 *
 * 用法：
 *   node scripts/dedupe-editions.mjs              干跑：只报告会撤下哪些
 *   node scripts/dedupe-editions.mjs --apply      写回台账
 *   node scripts/dedupe-editions.mjs --apply --limit 200
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findFfmpeg, fingerprintsOfFile, fingerprintsOfBuffer, compareFingerprints, isSameCover } from './lib/image-fp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');
const COVERS_DIR = path.join(ROOT, 'web', 'covers');
const INDEX_FILE = path.join(ROOT, 'data', 'covers.json');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const LIMIT = Number(argv[argv.indexOf('--limit') + 1]) || 0;
const DHash_TOL = 0.15;
const GRAY_TOL = 30;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', green: '\u001b[32m', yellow: '\u001b[33m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

if (!findFfmpeg()) {
  console.log(color('  ⚠ 本机没有 ffmpeg：无法比对图片，本脚本不做任何改动。', C.yellow));
  console.log('    （安装 ffmpeg 后重跑即可；项目其余部分不依赖它）');
  process.exit(0);
}

const books = new Map();
for (const f of fs.readdirSync(BOOKS_DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  for (const b of JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, f), 'utf8'))) books.set(b.id, b);
}
const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));

/** 同一张外链图可能被多部书引用，指纹缓存一下，省掉重复下载 */
const fpCache = new Map();

/** 取一个版本的指纹：本地文件直接算；只存链接的先下载再算 */
async function fpOf(edition) {
  if (!edition) return null;
  if (edition.file) {
    const p = path.join(COVERS_DIR, edition.file);
    if (fs.existsSync(p)) return fingerprintsOfFile(p);
  }
  if (edition.pic) {
    if (fpCache.has(edition.pic)) return fpCache.get(edition.pic);
    let fp = null;
    try {
      /**
       * **必须设超时**（第 175 轮踩的坑）：原先这里没有超时，
       * 外链 CDN 偶尔会连上却久久不回，`fetch` 就干等——实测整脚本卡成 **2.4 分钟/部**
       * （跑了 8 小时才处理 200 部）。10 秒拿不到就当取不到指纹，跳过这一版，不影响其余判断。
       */
      const res = await fetch(edition.pic, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'user-agent': UA, referer: 'https://weread.qq.com/' },
      });
      if (res.ok) fp = fingerprintsOfBuffer(Buffer.from(await res.arrayBuffer()), '.jpg');
    } catch {
      fp = null;
    }
    fpCache.set(edition.pic, fp);
    return fp;
  }
  return null;
}

const targets = Object.entries(index.records).filter(([, r]) => (r.editions || []).length > 1);
console.log('');
console.log(color(`  版本封面去重：${targets.length} 部有多版本${LIMIT ? `（本轮最多看 ${LIMIT} 部）` : ''}`, C.bold));
console.log(color(`  判据：结构指纹（16×16 dHash，三档裁切取最像）差 ≤ ${DHash_TOL * 100}% 且灰度差 ≤ ${GRAY_TOL}`, C.dim));
console.log('');

let checked = 0;
let droppedTotal = 0;
let noFp = 0;
let touchedFiles = new Set();
const samples = [];

for (const [id, rec] of targets) {
  if (LIMIT && checked >= LIMIT) break;
  checked += 1;
  const primary = rec.editions.find((e) => e.primary) || rec.editions[0];
  const primaryFp = await fpOf(primary);
  if (!primaryFp) {
    noFp += 1;
    continue;
  }
  const kept = [primary];
  const keptFps = [primaryFp];
  const dropped = [];
  for (const e of rec.editions) {
    if (e === primary) continue;
    const fp = await fpOf(e);
    if (!fp) {
      kept.push(e);
      keptFps.push(null);
      continue;
    }
    /** 与**已保留的每一版**比：只要和其中任何一版是同一张图，就不必再单列 */
    let dupOf = null;
    for (let i = 0; i < keptFps.length; i += 1) {
      if (!keptFps[i]) continue;
      if (isSameCover(fp, keptFps[i], { dhashTolerance: DHash_TOL, grayTolerance: GRAY_TOL })) {
        dupOf = kept[i];
        break;
      }
    }
    if (dupOf) {
      const cmp = compareFingerprints(fp, keptFps[kept.indexOf(dupOf)]);
      dropped.push({
        title: e.title || '',
        year: e.year || '',
        publisher: e.publisher || '',
        ...(e.remote ? { remote: true } : {}),
        sameAs: dupOf.title || '',
        structureDiff: cmp ? Number(cmp.dhash.toFixed(3)) : null,
        grayDiff: cmp ? Number(cmp.grayDiff.toFixed(1)) : null,
      });
      /** 若是本地文件，撤下之后要把图删掉，否则会变成孤儿文件（闸门会报） */
      if (e.file && e.file !== primary.file) {
        const p = path.join(COVERS_DIR, e.file);
        if (fs.existsSync(p)) {
          if (APPLY) fs.rmSync(p, { force: true });
          touchedFiles.add(e.file);
        }
      }
      droppedTotal += 1;
      if (samples.length < 12) {
        samples.push(
          `《${books.get(id)?.title}》：撤下「${e.title || '（无题）'}${e.year ? ` ${e.year}` : ''}${
            e.publisher ? ` · ${e.publisher}` : ''
          }」——与「${dupOf.title || '主图'}」结构差 ${cmp ? (cmp.dhash * 100).toFixed(1) : '?'}%`,
        );
      }
    } else {
      kept.push(e);
      keptFps.push(fp);
    }
  }
  if (dropped.length) {
    rec.editions = kept;
    rec.editionsDropped = [...(rec.editionsDropped || []), ...dropped];
  }
  if (checked % 200 === 0) console.log(color(`  … 已看 ${checked}/${Math.min(targets.length, LIMIT || targets.length)}`, C.dim));
}

console.log('');
console.log(color(`  ✓ 看过 ${checked} 部：撤下重复版本 ${droppedTotal} 条${noFp ? `（${noFp} 部拿不到指纹，跳过）` : ''}`, C.green));
if (samples.length) {
  console.log(color('  抽样（撤下的都是与已保留版本同一张图的）：', C.dim));
  for (const s of samples) console.log(color(`    · ${s}`, C.dim));
}
if (touchedFiles.size) console.log(`  连带删掉本地图片 ${touchedFiles.size} 张`);

if (!APPLY) {
  console.log('');
  console.log('  这是干跑。确认后加 --apply 写回。');
  process.exit(0);
}
index.generatedAt = new Date().toISOString();
fs.writeFileSync(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
console.log('  ✓ 已写回 data/covers.json');
console.log('  接着跑：node scripts/gen-cover-manifest.mjs && node scripts/check-covers.mjs');
