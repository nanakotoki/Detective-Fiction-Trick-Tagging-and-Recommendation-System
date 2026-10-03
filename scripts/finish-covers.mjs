#!/usr/bin/env node
/**
 * 封面线的「收尾一条命令」（第 182 轮·D 线）
 * ==========================================
 * 这一步是为**用户**写的，不是为我自己：豆瓣的 HTML 页一解封，缺的那 51 部就能补上，
 * 而收尾要按顺序跑一串脚本（顺序错了会互相覆盖，§174.2 踩过）。原先那串只写在
 * 我自己的临时目录里（`_dd/`, gitignore 掉的），仓库里没有——**那等于没交付**。
 *
 * 于是把它落成仓库里的一个脚本：
 *
 *   ① 上图查书号 → 豆瓣书号直达（补缺封面；默认干跑，这里带 --apply）
 *   ② 结构迁移（新增的非豆瓣主图要补 editions 数组，否则封面闸门会报错）
 *   ③ 版本图判重（同一张画不列成两版）
 *   ④ 跨书同图清理（同一张图不在两部书里各显示一次）
 *   ⑤ 主图换回题名一致的那一版（外文／繁体版不顶掉中文版）
 *   ⑥ 小封面升级（同一张画、CDN 上有更大的才换）
 *   ⑦ 重建前端清单
 *   ⑧ 封面闸门
 *   ⑨ 重复图体检（必须 0 组）
 *   ⑩ 书名取证体检（只报不改）
 *   ⑪ 同条目体检（只报不改）
 *   ⑫ 八道门禁与全部测试
 *
 * 用法：
 *   npm run covers:finish             全跑（含体检）
 *   npm run covers:finish -- --quick  跳过最后两步里最慢的重复图体检
 *   npm run covers:finish -- --dry    一律干跑（不写任何数据，只看会做什么）
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const QUICK = argv.includes('--quick');
const DRY = argv.includes('--dry');
const applyFlag = DRY ? [] : ['--apply'];

const steps = [
  ['① 上图查书号 → 豆瓣书号直达', ['scripts/backfill-isbn-covers.mjs', ...applyFlag]],
  ['② 结构迁移（补 editions 数组）', ['scripts/fetch-covers.mjs', '--seed-editions']],
  ['③ 版本图判重', ['scripts/dedupe-editions.mjs', ...applyFlag]],
  ['④ 跨书同图清理', ['scripts/dedupe-cross-book.mjs', ...applyFlag]],
  ['⑤ 主图换回题名一致的那一版', ['scripts/promote-matching-edition.mjs', ...applyFlag]],
  ['⑥ 小封面升级', ['scripts/upgrade-small-covers.mjs', ...applyFlag]],
  ['⑦ 重建前端清单', ['scripts/gen-cover-manifest.mjs']],
  ['⑧ 封面闸门', ['scripts/check-covers.mjs']],
  ...(QUICK ? [] : [['⑨ 重复图体检（必须 0 组）', ['scripts/audit-cover-dups.mjs']]]),
  ['⑩ 书名取证体检（只报不改）', ['scripts/audit-edition-titles.mjs']],
  ['⑪ 同条目体检（只报不改）', ['scripts/audit-shared-entries.mjs']],
  ['⑫ 八道门禁与全部测试', ['scripts/build.mjs']],
];

const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', green: '\u001b[32m', red: '\u001b[31m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

console.log('');
console.log(color(`  封面线收尾：${steps.length} 步${DRY ? '（干跑）' : ''}${QUICK ? '（跳过重复图体检）' : ''}`, C.bold));
console.log(color('  顺序不能换：抓取/清理类都会写台账与图片，收尾的清单与门禁必须放最后', C.dim));
console.log('');

const failures = [];
for (const [label, args] of steps) {
  console.log(color(`  ▶ ${label}`, C.bold));
  const started = Date.now();
  const res = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: ROOT });
  const secs = Math.round((Date.now() - started) / 1000);
  if (res.status !== 0) failures.push(`${label}（退出码 ${res.status}）`);
  console.log(color(`  ${res.status === 0 ? '✓' : '✗'} ${label}（${secs}s）`, res.status === 0 ? C.green : C.red));
  console.log('');
}

if (failures.length) {
  console.log(color(`  ✗ 有 ${failures.length} 步没过：`, C.red));
  for (const f of failures) console.log(color(`    · ${f}`, C.red));
  process.exit(1);
}
console.log(color('  ✓ 收尾链全部通过', C.green));
if (DRY) console.log(color('  （这是干跑：数据没有被改动）', C.dim));
