#!/usr/bin/env node
/**
 * 恢复被覆盖的封面判据（第 177 轮·D 线）
 * ======================================
 * 事故经过（自己查出来的，不是外部报的）：
 *
 *   1. 第 167 轮给全库配封面时，每条记录都记了**判据**（`matched`）：
 *      `subject-id`＝与评分取自同一条豆瓣条目、`isbn`＝书号直达、`title+year`＝题名加年份……
 *      全库 **2371 部**是强链接。
 *   2. 第 169／170 轮的「版本一览」把主图重挑了一遍（同年优先、否则最新），
 *      收工时顺手把 `matched` **整条改写**成 `editions+works` / `editions+weread`——
 *      于是**原来的判据没了**：全库从「2371 部强链接」变成「448 部 S」。
 *   3. 更糟的是前端：这两个判据名不在映射表里，被兜底成 `W`＝**「仅题名吻合（弱链接）」**，
 *      2485 部书的档案页把自己的强取证**说成了弱链接**——自己把自己的证据说轻了。
 *
 * 这一轮的处理分两步，都不猜：
 *
 *   a. **判据码映射补齐**（`scripts/lib/covers.mjs` 的 `coverCodeOf`）：`editions+works`／
 *      `editions+weread` 落到 **Y（与所收版本同年）／N（最新）**，不再落到 W。
 *   b. **按快照恢复判据**（本脚本）：版本一览那一轮**并没有真的换掉图**——
 *      与 22:10（`85b0346`，版本一览跑之前的最后一次提交）比，
 *      全库 2485 条被覆盖的记录里 **2010 条的图片文件与条目 id 一模一样**。
 *      图既然没换，判据就该是原来那条。恢复的前提三条同时成立：
 *        ① 快照里有这条记录；② `file` 与 `subjectId` 都没变；③ 没有 `replacedFrom`（没被版本择优换过）。
 *      不满足的（475 条）**保持 Y/N**——那些确实是在版本一览里重新挑过的一版。
 *
 * 用法：
 *   git show 85b0346:data/covers.json > snapshot.json     # 先导出快照
 *   node scripts/restore-cover-evidence.mjs --from snapshot.json           干跑
 *   node scripts/restore-cover-evidence.mjs --from snapshot.json --apply   写回
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INDEX_FILE = path.join(ROOT, 'data', 'covers.json');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const fromArg = argv[argv.indexOf('--from') + 1];
if (!fromArg || fromArg.startsWith('--')) {
  console.error('  用法：node scripts/restore-cover-evidence.mjs --from <快照.json> [--apply]');
  process.exit(2);
}

const color = (t, c) => (process.stdout.isTTY ? `${c}${t}\u001b[0m` : String(t));
const GREEN = '\u001b[32m';
const DIM = '\u001b[2m';
const BOLD = '\u001b[1m';

const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(fromArg, 'utf8').replace(/^\uFEFF/, ''));

/** 版本一览那两轮写下的判据名——只有这些才需要回头看快照 */
const OVERWRITTEN = new Set(['editions+works', 'editions+weread']);

const restored = {};
const kept = {};
let restoredCount = 0;
let keptCount = 0;
const samples = [];

for (const [id, rec] of Object.entries(index.records || {})) {
  if (!OVERWRITTEN.has(rec.matched)) continue;
  const was = snapshot.records?.[id];
  const unchanged = was && was.file === rec.file && (was.subjectId || '') === (rec.subjectId || '') && !rec.replacedFrom;
  if (!unchanged) {
    keptCount += 1;
    kept[rec.matched] = (kept[rec.matched] || 0) + 1;
    continue;
  }
  restored[was.matched || '(无)'] = (restored[was.matched || '(无)'] || 0) + 1;
  if (samples.length < 5) samples.push(`${id}《${was.title || rec.title || ''}》${rec.matched} → ${was.matched}`);
  if (APPLY) {
    rec.matched = was.matched;
    /** 留一句可追溯的话：这条判据是恢复来的，不是这一轮重新取的证 */
    rec.matchedRestored = {
      from: path.basename(fromArg),
      at: new Date().toISOString(),
      note: '版本一览那轮曾把判据覆盖成 editions+*；图片与条目未变，判据按快照恢复',
    };
  }
  restoredCount += 1;
}

console.log('');
console.log(color(`  恢复被覆盖的封面判据：快照 ${path.basename(fromArg)}`, BOLD));
console.log(color(`  ${APPLY ? '★ --apply：写回 data/covers.json' : '干跑（要看结果加 --apply）'}`, DIM));
console.log('');
console.log(`  可恢复（图片与条目 id 都没变）：${restoredCount} 条`);
for (const [k, v] of Object.entries(restored).sort((a, b) => b[1] - a[1])) console.log(`     ${String(v).padStart(4)}  ${k}`);
console.log(`  保持 Y/N（版本一览里确实重挑过）：${keptCount} 条`);
for (const [k, v] of Object.entries(kept).sort((a, b) => b[1] - a[1])) console.log(`     ${String(v).padStart(4)}  ${k}`);
if (samples.length) {
  console.log('');
  console.log(color('  例：', DIM));
  for (const s of samples) console.log(color(`     · ${s}`, DIM));
}

if (!APPLY) {
  console.log('');
  console.log(color('  干跑结束：加 --apply 才写回。', DIM));
  process.exit(0);
}

fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2) + '\n', 'utf8');
console.log('');
console.log(color(`  ✓ 已写回 data/covers.json（恢复 ${restoredCount} 条，保留 ${keptCount} 条）`, GREEN));
console.log(color('  下一步：node scripts/gen-cover-manifest.mjs && node scripts/check-covers.mjs', DIM));
