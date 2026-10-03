#!/usr/bin/env node
/**
 * 清理「指向已不存在图片」的版本（第 176 轮）
 * ==========================================
 * 起因：昨夜那个判重进程在写回台账**之前**被打断（关机/停任务），
 * 它已经删掉了若干「判为重复」的本地图片，但记录没更新——
 * 于是台账里留着 113 个**指向已删文件**的版本，封面闸门报「版本图片不在盘上」。
 *
 * 这不是数据损坏，是**中断留下的半成品**：那些版本本来就已被判为重复（图已删），
 * 只是台账没来得及跟着改。所以处理方式是把它们从 `editions` 里摘掉，
 * 并在 `editionsDropped` 里留一条明确理由（可追溯），而不是假装它们还在。
 *
 * 顺带也会修 `record.file` 指向不存在的主图（极少见）：那就从幸存版本里挑最新的顶上。
 *
 * 用法：
 *   node scripts/prune-missing-editions.mjs           干跑
 *   node scripts/prune-missing-editions.mjs --apply   写回
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const COVERS_DIR = path.join(ROOT, 'web', 'covers');
const INDEX_FILE = path.join(ROOT, 'data', 'covers.json');

const APPLY = process.argv.includes('--apply');
const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', green: '\u001b[32m', yellow: '\u001b[33m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
const exists = (f) => Boolean(f) && fs.existsSync(path.join(COVERS_DIR, f));

let pruned = 0;
let fixedPrimary = 0;
let touched = 0;
const samples = [];

for (const [id, rec] of Object.entries(index.records)) {
  if (!Array.isArray(rec.editions) || !rec.editions.length) {
    // 主图文件都没了：把记录整体摘掉，交给抓取重新取（宁缺毋滥）
    if (!exists(rec.file)) {
      if (samples.length < 10) samples.push(`${id}：连主图 ${rec.file} 都不在，整条撤下`);
      if (APPLY) {
        index.misses[id] = {
          title: rec.edition?.title || '',
          reason: '原封面文件缺失（上一轮中断留下的半成品），已整条撤下待重抓',
          triedAt: new Date().toISOString(),
        };
        delete index.records[id];
      }
      pruned += 1;
      touched += 1;
    }
    continue;
  }

  const kept = [];
  const dropped = [];
  for (const e of rec.editions) {
    /**
     * 只存链接的版本（微信读书，`remote: true` + `pic`）**本来就没有本地文件**，
     * 不能当成「图片缺失」——第一版就是这么误判的：干跑报「1068 条」，
     * 而封面闸门只报 113 条，差的正是这些外链版本。
     */
    if (e.remote && e.pic) {
      kept.push(e);
      continue;
    }
    if (exists(e.file)) {
      kept.push(e);
      continue;
    }
    dropped.push({
      title: e.title || '',
      year: e.year || '',
      publisher: e.publisher || '',
      why: '图片在上一轮判重被删、台账未及更新；本版无图可显示，摘除待重抓',
    });
    pruned += 1;
  }
  if (!kept.length) continue; // 全都没图，下一轮由上面的分支处理

  // 主图必须存在且是 editions[0]：不在就顺位顶上（并重命名为主图文件名）
  let primary = kept[0];
  if (!exists(rec.file) || !kept.some((e) => e.file === rec.file)) {
    fixedPrimary += 1;
    if (samples.length < 10) samples.push(`${id}：主图缺失，改用幸存版本 ${primary.file}`);
  }
  for (const e of kept) e.primary = e.file === primary.file;
  if (APPLY && (dropped.length || fixedPrimary)) {
    rec.editions = kept;
    if (dropped.length) rec.editionsDropped = [...(rec.editionsDropped || []), ...dropped];
    rec.file = primary.file;
    rec.bytes = primary.bytes ?? rec.bytes;
    rec.width = primary.width ?? rec.width;
    rec.height = primary.height ?? rec.height;
    rec.format = primary.format ?? rec.format;
    if (primary.subjectId) rec.subjectId = primary.subjectId;
    rec.edition = { title: primary.title || rec.edition?.title || '', author: rec.edition?.author || '', year: primary.year || '' };
    touched += 1;
  } else if (dropped.length) {
    touched += 1;
  }
}

console.log('');
console.log(color(`  清理「指向不存在图片」的版本：${pruned} 条${fixedPrimary ? `，另外修正主图 ${fixedPrimary} 处` : ''}`, C.bold));
for (const s of samples) console.log(color(`    · ${s}`, C.dim));
if (!APPLY) {
  console.log('');
  console.log('  这是干跑。加 --apply 写回。');
  process.exit(0);
}
index.generatedAt = new Date().toISOString();
fs.writeFileSync(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
console.log(`  ✓ 已写回 data/covers.json（涉及 ${touched} 条记录）`);
console.log('  接着跑：node scripts/gen-cover-manifest.mjs && node scripts/check-covers.mjs');
