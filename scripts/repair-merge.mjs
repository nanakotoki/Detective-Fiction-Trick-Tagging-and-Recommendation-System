#!/usr/bin/env node
/**
 * 合并台账回填（维护工具）
 * ======================
 * `merge-dups.mjs` 早期版本有一个写回 bug：它只在「该文件删掉过记录」时才落盘，
 * 于是**只当赢家、一条都没删的那个文件**被整体跳过——赢家记录拿不到合并结果
 * （标签并集、alternateTitles、mergedFrom 溯源全丢），而脚本仍报合并成功。
 *
 * 本脚本读取 `data/books/_merged/` 里的台账，把还能补回来的部分补回去：
 *   · alternateTitles（落选那一版的中文书名）——可从台账完整恢复；
 *   · provenance.mergedFrom / mergeNote——可从台账完整恢复；
 *   · **标签并集无法恢复**：落选记录的标签已随文件写入被删除，
 *     台账只记了数量（tagsBefore / tagsAfter）。脚本会把「当前标签数 < tagsAfter」
 *     的条目列出来，交由人工重新标注。
 *
 * 幂等：已经补过的条目不会被重复处理。
 *
 * 用法：
 *   node scripts/repair-merge.mjs            预演
 *   node scripts/repair-merge.mjs --apply    写入
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');
const TOMB_DIR = path.join(BOOKS_DIR, '_merged');

const APPLY = process.argv.includes('--apply');

if (!fs.existsSync(TOMB_DIR)) {
  console.log('\n  没有找到合并台账（data/books/_merged/），无需回填。\n');
  process.exit(0);
}

/** 文件 → 数组缓存 */
const store = new Map();
const load = (file) => {
  if (!store.has(file)) {
    store.set(file, JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, file), 'utf8')));
  }
  return store.get(file);
};

const ledgers = fs.readdirSync(TOMB_DIR).filter((f) => f.endsWith('.json')).sort();
const fixed = [];
const tagGaps = [];
const missing = [];

for (const ledger of ledgers) {
  const entries = JSON.parse(fs.readFileSync(path.join(TOMB_DIR, ledger), 'utf8'));
  for (const e of entries) {
    const [file, id] = String(e.keep).split('#');
    let list;
    try {
      list = load(file);
    } catch {
      missing.push(`${e.keep}（文件读取失败）`);
      continue;
    }
    const rec = list.find((b) => b.id === id);
    if (!rec) {
      missing.push(`${e.keep}（记录不存在，可能已被后续合并处理）`);
      continue;
    }

    let changed = false;

    // 1. 补 alternateTitles
    const wantAlt = Array.isArray(e.alternateTitles) ? e.alternateTitles.filter(Boolean) : [];
    const haveAlt = Array.isArray(rec.alternateTitles) ? rec.alternateTitles : [];
    const mergedAlt = [...new Set([...haveAlt, ...wantAlt])].filter((t) => t !== rec.title);
    if (JSON.stringify(mergedAlt) !== JSON.stringify(haveAlt)) {
      rec.alternateTitles = mergedAlt;
      changed = true;
    }

    // 2. 补 provenance
    const prov = rec.provenance && typeof rec.provenance === 'object' ? rec.provenance : {};
    const dropList = Array.isArray(e.drop) ? e.drop : [];
    const haveFrom = Array.isArray(prov.mergedFrom) ? prov.mergedFrom : [];
    const dropIds = dropList
      .map((d) => String(d).replace(/（.*?）\s*$/, '').replace(/^(.+?)#/, '$1#'))
      .filter((d) => !haveFrom.includes(d));
    if (!prov.mergedFrom || dropIds.length) {
      rec.provenance = {
        ...prov,
        mergedFrom: [...new Set([...haveFrom, ...dropIds])],
        mergedAt: prov.mergedAt ?? new Date().toISOString().slice(0, 7),
        mergeNote:
          prov.mergeNote ??
          '本条由重复条目合并而来：标签与流派取并集，评分逐平台取较新的一条，梗概与阅读提示保留主条目原文；另一版本的中文书名保留在 alternateTitles 中，搜索仍可命中。',
      };
      changed = true;
    }

    if (changed) fixed.push({ keep: e.keep, title: rec.title, alt: mergedAlt, from: dropIds });

    // 3. 标签缺口（无法自动恢复，只能报告）
    // ⚠️ tags 与 school 是两个独立维度，台账里的 tagsAfter / schoolAfter 也是分开记的，
    // 必须分别比对。混在一起算会把「标签少了 5 个、流派多了 3 个」当成没缺口。
    const nowTags = (rec.tags ?? []).length;
    const nowSchool = (rec.school ?? rec.schoolTags ?? []).length;
    const wantTags = Number(e.tagsAfter) || 0;
    const wantSchool = Number(e.schoolAfter) || 0;
    if (nowTags < wantTags || nowSchool < wantSchool) {
      tagGaps.push({
        keep: e.keep,
        title: rec.title,
        nowTags,
        wantTags,
        nowSchool,
        wantSchool,
        currentTags: rec.tags ?? [],
        currentSchool: rec.school ?? rec.schoolTags ?? [],
      });
    }
  }
}

console.log('');
console.log('  合并台账回填');
console.log('  ────────────────────────────────────────────');
console.log(`  台账 ${ledgers.length} 份`);
console.log('');

if (fixed.length) {
  console.log(`  可回填 ${fixed.length} 条（alternateTitles / 溯源）：`);
  for (const f of fixed) {
    console.log(`      ${f.keep}  《${f.title}》`);
    if (f.alt.length) console.log(`          又名 → ${f.alt.join(' / ')}`);
    if (f.from.length) console.log(`          来源 → ${f.from.join(', ')}`);
  }
} else {
  console.log('  ✓ 没有需要回填的条目');
}

if (missing.length) {
  console.log('');
  console.log(`  ! ${missing.length} 条台账记录找不到对应条目：`);
  for (const m of missing) console.log(`      ${m}`);
}

if (tagGaps.length) {
  console.log('');
  console.log(`  ! ${tagGaps.length} 条标签／流派少于合并时应有的数量（并集无法自动恢复，需人工重标）：`);
  for (const g of tagGaps) {
    const parts = [];
    if (g.nowTags < g.wantTags) parts.push(`标签 ${g.nowTags}→应 ${g.wantTags}（缺 ${g.wantTags - g.nowTags}）`);
    if (g.nowSchool < g.wantSchool) parts.push(`流派 ${g.nowSchool}→应 ${g.wantSchool}（缺 ${g.wantSchool - g.nowSchool}）`);
    console.log(`      ${g.keep}  《${g.title}》  ${parts.join('，')}`);
    console.log(`          标签：${g.currentTags.join(', ') || '（无）'}`);
    console.log(`          流派：${g.currentSchool.join(', ') || '（无）'}`);
  }
}
console.log('');

if (!APPLY) {
  console.log('  预演模式（未写入）。加 --apply 执行。');
  console.log('');
  process.exit(0);
}

let touched = 0;
for (const [file, list] of store) {
  const orig = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, file), 'utf8'));
  if (JSON.stringify(orig) === JSON.stringify(list)) continue;
  fs.writeFileSync(path.join(BOOKS_DIR, file), `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  touched++;
}
console.log(`  ✓ 已写入 ${touched} 个文件`);
console.log('');
