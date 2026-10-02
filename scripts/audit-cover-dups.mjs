#!/usr/bin/env node
/**
 * 版本封面重复体检（第 172 轮）
 * ============================
 * 起因：用户判断「重复很可能是采用不同网站搜索的原因」——查下来**完全正确**：
 * 撤下的 847 条重复**全部**是跨站重复（同一张封面豆瓣与微信读书各一份），豆瓣侧内部 0 条。
 *
 * 既然「多来源并存 ⇒ 跨站重复是系统性的」，那它就不该只是一次性的清理，
 * 而要有**可随时复跑的体检**：新接了来源、豆瓣恢复后又补了一批版本、或者哪天调了判重阈值，
 * 都拿这条命令验一遍。
 *
 * 它做的事：把每一部多版本作品的所有版本图都取来算指纹（本地文件直接算，
 * 只存链接的下载后算），两两比对，报出**仍然判为同一张**的组合。
 *
 * 用法：
 *   node scripts/audit-cover-dups.mjs            只看报告（有问题退出码 1）
 *   node scripts/audit-cover-dups.mjs --limit 300
 *
 * 注意：本机没有 ffmpeg 时无法比对，会明确说明并跳过（退出码 0）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findFfmpeg, fingerprintsOfFile, fingerprintsOfBuffer, compareFingerprints, isSameCover } from './lib/image-fp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const COVERS_DIR = path.join(ROOT, 'web', 'covers');
const INDEX_FILE = path.join(ROOT, 'data', 'covers.json');

const argv = process.argv.slice(2);
const LIMIT = Number(argv[argv.indexOf('--limit') + 1]) || 0;
const DHash_TOL = 0.15;
const GRAY_TOL = 30;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', green: '\u001b[32m', red: '\u001b[31m', yellow: '\u001b[33m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

if (!findFfmpeg()) {
  console.log(color('  ⚠ 本机没有 ffmpeg：无法比对图片，体检跳过。', C.yellow));
  process.exit(0);
}

const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
const targets = Object.entries(index.records).filter(([, r]) => (r.editions || []).length > 1);

async function fpOf(edition) {
  if (edition?.file) {
    const p = path.join(COVERS_DIR, edition.file);
    if (fs.existsSync(p)) return fingerprintsOfFile(p);
  }
  if (edition?.pic) {
    try {
      const res = await fetch(edition.pic, { headers: { 'user-agent': UA, referer: 'https://weread.qq.com/' } });
      if (!res.ok) return null;
      return fingerprintsOfBuffer(Buffer.from(await res.arrayBuffer()), '.jpg');
    } catch {
      return null;
    }
  }
  return null;
}

console.log('');
console.log(color(`  版本封面重复体检：${targets.length} 部有多版本${LIMIT ? `（最多看 ${LIMIT} 部）` : ''}`, C.bold));
console.log(color(`  判据：结构指纹差 ≤ ${DHash_TOL * 100}% 且灰度差 ≤ ${GRAY_TOL}（与写入时、清理时同一套）`, C.dim));
console.log('');

let checked = 0;
let noFp = 0;
const dupes = [];
for (const [id, rec] of targets) {
  if (LIMIT && checked >= LIMIT) break;
  checked += 1;
  const fps = [];
  for (const e of rec.editions) fps.push({ e, fp: await fpOf(e) });
  if (fps.every((x) => !x.fp)) {
    noFp += 1;
    continue;
  }
  for (let i = 0; i < fps.length; i += 1) {
    for (let j = i + 1; j < fps.length; j += 1) {
      if (!fps[i].fp || !fps[j].fp) continue;
      if (isSameCover(fps[i].fp, fps[j].fp, { dhashTolerance: DHash_TOL, grayTolerance: GRAY_TOL })) {
        const cmp = compareFingerprints(fps[i].fp, fps[j].fp);
        dupes.push(
          `${id}：「${fps[i].e.title || '?'}${fps[i].e.year ? ` ${fps[i].e.year}` : ''}」 ↔ 「${fps[j].e.title || '?'}${
            fps[j].e.year ? ` ${fps[j].e.year}` : ''
          }」结构差 ${(cmp.dhash * 100).toFixed(1)}%`,
        );
      }
    }
  }
  if (checked % 200 === 0) console.log(color(`  … 已看 ${checked}`, C.dim));
}

console.log('');
console.log(`  看过 ${checked} 部${noFp ? `（${noFp} 部拿不到指纹）` : ''}`);
if (!dupes.length) {
  console.log(color('  ✓ 没有发现仍然重复的版本', C.green));
  process.exit(0);
}
console.log(color(`  ✗ 仍发现 ${dupes.length} 组疑似重复：`, C.red));
for (const d of dupes.slice(0, 30)) console.log(color(`    · ${d}`, C.red));
if (dupes.length > 30) console.log(color(`    … 其余 ${dupes.length - 30} 组省略`, C.dim));
console.log('');
console.log('  处理：node scripts/dedupe-editions.mjs --apply');
process.exit(1);
