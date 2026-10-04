#!/usr/bin/env node
/**
 * 清理孤儿封面图（第 186 轮·D 线）
 * ==============================
 * 「孤儿」＝ `web/covers/` 里存在、但**封面台账里没有任何记录或版本引用**的图片文件。
 *
 * 它们是怎么来的：长尾抓取会重写一部书的 `editions`（每部只留最新的 3 版），
 * 掉出列表的旧版本图如果没删，就成了孤儿——2026-10-04 那轮实测 **235 张、3.46MB**，
 * 封面闸门会直接报红（它对孤儿是零容忍的：台账与盘上必须一一对应）。
 *
 * 抓取脚本那边已经补了「落选就删」的根因修复；这个脚本用来**收拾已经落下的**，
 * 以及以后任何一次中断留下的残留（第 175、177 轮都碰到过）。
 *
 * 用法：
 *   node scripts/prune-orphan-images.mjs            干跑：列出孤儿与体积
 *   node scripts/prune-orphan-images.mjs --apply    真删
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const COVERS_DIR = path.join(ROOT, 'web', 'covers');
const INDEX_FILE = path.join(ROOT, 'data', 'covers.json');

const APPLY = process.argv.includes('--apply');
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}\u001b[0m` : String(t));
const GREEN = '\u001b[32m';
const DIM = '\u001b[2m';

const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
const referenced = new Set();
for (const rec of Object.values(index.records || {})) {
  if (rec.file) referenced.add(rec.file);
  for (const e of rec.editions || []) if (e.file) referenced.add(e.file);
}

const orphans = [];
let bytes = 0;
for (const f of fs.readdirSync(COVERS_DIR)) {
  if (f === '_placeholder.svg') continue;
  const p = path.join(COVERS_DIR, f);
  if (!fs.statSync(p).isFile()) continue;
  if (referenced.has(f)) continue;
  orphans.push(f);
  bytes += fs.statSync(p).size;
}

console.log('');
console.log(`  孤儿封面图：${orphans.length} 张、${(bytes / 1048576).toFixed(2)} MB${APPLY ? '　★ 将删除' : '（干跑）'}`);
for (const f of orphans.slice(0, 10)) console.log(color(`    · ${f}`, DIM));
if (orphans.length > 10) console.log(color(`    … 其余 ${orphans.length - 10} 张省略`, DIM));

if (!APPLY) {
  console.log('');
  console.log('  干跑结束。确认后加 --apply（这些文件台账里确实没有任何引用）。');
  process.exit(orphans.length ? 1 : 0);
}
let removed = 0;
for (const f of orphans) {
  fs.rmSync(path.join(COVERS_DIR, f), { force: true });
  removed += 1;
}
console.log('');
console.log(color(`  ✓ 已删除 ${removed} 张（${(bytes / 1048576).toFixed(2)} MB）`, GREEN));
console.log(color('  接着跑：node scripts/check-covers.mjs', DIM));
