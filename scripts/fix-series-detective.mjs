#!/usr/bin/env node
/**
 * 补齐系列作品的主角字段（一次性修复）
 * ==================================
 * `audit-offline.mjs` 查出 14 部作品标了 series 却没写 detective，
 * 详情页的「系列 · 主角」一行因此显示不全，系列检索也会弱化。
 *
 * 只补**主角能确证**的那几部；其余（如森村诚一「证明三部曲」是主题三部曲、
 * 不含共同侦探；折原一「倒错系列」靠叙述诡计串联，没有固定侦探）**保持留空**，
 * 宁可不填，也不编一个名字进去。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');

/** id → 主角。每条都能在作品本身的系列设定里核实 */
const PLAN = {
  'chinese-001': '严良', // 紫金陈「推理之王」系列，《坏小孩》《长夜难明》共同的警察角色
  'chinese-002': '严良',
  'jpmod2-017': '又市', // 京极夏彦「巷说百物语」系列的串联主角
  'jpmod2-027': '三津田信三', // 「作家」系列：作者本人作为小说角色登场
  'jpmod3-005': '硝子之侦探', // 小岛正树「硝子之侦探」系列，书名即主角
  'jpmod3-006': '硝子之侦探',
};

/** 明确不补的，写在这里以免以后有人反复试 */
const DELIBERATELY_SKIPPED = {
  'jpmod-002': '森村诚一「证明三部曲」是主题三部曲，不含共同侦探',
  'shinhonkaku-011': '折原一「倒错系列」靠叙述结构串联，无固定侦探',
  'jpnew-028': '同上',
  'chinese3-018': '《十宗罪》系列为特案组群像，未确证单一主角',
  'honkaku-006': '绫辻行人「馆系列」由建筑串联，各作侦探不同',
  'jphk-015': '北山猛邦「侦探仪式」系列的主角设定未核实',
  'jphk-016': '同上',
  'jphk-017': '同上',
};

let touched = 0;
const done = [];
for (const file of fs.readdirSync(BOOKS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()) {
  const abs = path.join(BOOKS_DIR, file);
  const list = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!Array.isArray(list)) continue;
  let dirty = false;
  for (const b of list) {
    const who = PLAN[b.id];
    if (!who) continue;
    if (String(b.detective ?? '').trim() === who) continue;
    b.detective = who;
    dirty = true;
    done.push(`${b.id}  《${b.title}》 → ${who}`);
  }
  if (dirty) {
    fs.writeFileSync(abs, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
    touched += 1;
  }
}

console.log('');
console.log('  补齐系列主角');
console.log('  ────────────────────────────────────────────');
for (const d of done) console.log(`  ✓ ${d}`);
console.log('');
console.log(`  已写入 ${touched} 个文件`);
console.log(`  另有 ${Object.keys(DELIBERATELY_SKIPPED).length} 部**故意留空**（无从确证主角）：`);
for (const [id, why] of Object.entries(DELIBERATELY_SKIPPED)) console.log(`      ${id}  ${why}`);
console.log('');
