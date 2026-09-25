#!/usr/bin/env node
/**
 * 同书异名定案器 `shlib-orig-scan`
 * ==============================
 * **为什么需要它**：候选池里最贵的错不是「收了不该收的」，而是**把同一部作品按两个译名收两遍**。
 * 而这类错 `find-duplicates.mjs` 抓不到——题名不同、`originalTitle` 又常常是空的。
 *
 * 已踩过的坑（都记在 `docs/collection-backlog.md`）：
 *   · 贵州人民 1998「克里斯蒂作品全集」旧译名（《罗杰·艾克罗伊德谋杀案》＝《罗杰疑案》）；
 *   · 珠海版《盲兽》与《人豹》**共用同一个 ISBN**，实为一册书的两条著录；
 *   · 《遗产风波》＝*Taken at the Flood*＝库内《顺水推舟》。
 *
 * **本脚本给出的正是能定案的那个字段**：上图 CNMARC 的
 * **500／501／510／517（统一题名·并列题名·其他题名）**——馆藏**直接写出了原作名**，
 * 比任何二手对照表都硬。同时打印主题词与中图法，可顺手确认题材判据。
 *
 * 用法：
 *   node scripts/shlib-orig-scan.mjs --file _dd/orig-titles.txt --out _dd/orig-scan.tsv [--author 钱德勒] [--delay 700]
 *   每行一个题名；`--author` 可选，用来滤掉同名异作者的行（子串匹配）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { BASE, parseMarc, subValues, allAuthorsOf, primaryAuthorOf, subjectsOf, clcOf, imprintOf, isbnOf } from './lib/shlib.mjs';

const argv = process.argv.slice(2);
const val = (f, d = null) => {
  const i = argv.indexOf(f);
  return i === -1 ? d : argv[i + 1];
};
const FILE = val('--file');
const OUT = val('--out', '_dd/orig-scan.tsv');
const AUTHOR = val('--author', '');
const DELAY = Number(val('--delay', '700'));
if (!FILE) {
  console.log('\n  用法：node scripts/shlib-orig-scan.mjs --file 题名清单.txt [--author 作者] [--out x.tsv]\n');
  process.exit(1);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const F = 'field[]=title&field[]=authors&field[]=publishers&field[]=publicationDates&field[]=subjects&field[]=rawData';

const titles = readFileSync(FILE, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const out = ['查询题名\t命中\t馆藏题名\t出版项\t主题词\t中图法\tISBN\t原作名字段'];

for (const t of titles) {
  let recs = [];
  try {
    const url = `${BASE}/api/v1/search?lookfor=${encodeURIComponent(t)}&type=Title&limit=20&${F}`;
    const j = await (await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } })).json();
    recs = j?.records || [];
  } catch (e) {
    out.push(`${t}\t请求失败\t\t\t\t\t\t${e.message}`);
    console.log(`✗ ${t} → ${e.message}`);
    await sleep(DELAY);
    continue;
  }
  const rows = [];
  for (const r of recs) {
    const p = parseMarc(r.rawData?.fullrecord || '');
    const names = allAuthorsOf(p).join('、') + '｜' + primaryAuthorOf(p);
    if (AUTHOR && !names.includes(AUTHOR)) continue;
    const orig = [
      ...subValues(p, '500', 'a'),
      ...subValues(p, '501', 'a'),
      ...subValues(p, '510', 'a'),
      ...subValues(p, '517', 'a'),
      ...subValues(p, '541', 'a'),
      ...subValues(p, '200', 'd'),
    ].join(' ; ');
    rows.push({
      title: subValues(p, '200', 'a').join(''),
      imprint: imprintOf(p),
      subjects: subjectsOf(p).join(' '),
      clc: String(clcOf(p)),
      isbn: isbnOf(p).join('/'),
      orig,
    });
  }
  out.push(
    rows.length
      ? rows.map((r) => [t, rows.length, r.title, r.imprint, r.subjects, r.clc, r.isbn, r.orig].join('\t')).join('\n')
      : `${t}\t0\t\t\t\t\t\t`,
  );
  console.log(`· ${t} → 命中 ${rows.length}`);
  for (const r of rows) console.log(`    ${r.title} ｜ ${r.imprint} ｜ 原题：${r.orig || '—'}`);
  await sleep(DELAY);
}
writeFileSync(OUT, out.join('\n') + '\n', 'utf8');
console.log(`\n明细 → ${OUT}`);
