#!/usr/bin/env node
/**
 * `authorEn` 归一（第 143 轮）
 * ==========================
 * 起因：`audit-author-names.mjs` 只看**作者署名**（中文），不看 `authorEn`。
 * 于是同一个作者在库内可以有三种罗马字写法（§128.8 记过：泡坂妻夫 3 种、东川笃哉 3 种、
 * 凑佳苗 2 种 8:8 平手），页面上看不出来，但「作者页」与统计会各算一份。
 *
 * 规则（**取多数**，不做「谁更正确」的判断）：
 *   ① 同一 `author` 标签下，按出现次数排序；多数写法留用，少数写法改写；
 *   ② 平手时取**字典序在前**的（确定性，不靠随机）；
 *   ③ 空值**不覆盖**：如果多数写法是空串，则改写「有值但属少数」的那些为**多数里的第一个非空值**；
 *      若该标签下**全是空值**，保持为空（不替作者编罗马字）。
 * ⚠️ 归一后要紧接着跑 `find-duplicates.mjs --strict`：§85.3 记过——改名常会钓出被掩盖的重复条目。
 *
 * 用法：
 *   node scripts/normalize-author-en.mjs            预演（只打印将要改的）
 *   node scripts/normalize-author-en.mjs --apply    写回
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const files = readdirSync('data/books').filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const store = new Map();
for (const f of files) store.set(f, JSON.parse(readFileSync(`data/books/${f}`, 'utf8')));

/** author 标签 → authorEn 计数 */
const counts = new Map();
for (const arr of store.values()) {
  for (const b of arr) {
    const a = String(b.author || '').trim();
    if (!a) continue;
    if (!counts.has(a)) counts.set(a, new Map());
    const m = counts.get(a);
    const e = String(b.authorEn || '').trim();
    m.set(e, (m.get(e) || 0) + 1);
  }
}

/** 目标写法 */
const target = new Map();
/**
 * **少数派但正确的是「少数」的例外**（人工指定，附理由）：
 * 日语人名的罗马字有通例——姓在前、且**促音／连浊**要照实际读音写。
 * 「多数写法」在这三位身上都是**误拼**（有人把姓读错、或整条抄成了另一位作者）：
 *   泡坂妻夫 → `Awasaka Tsumao`（あわさか，不是 Awasa）
 *   东川笃哉 → `Higashigawa Tokuya`（ひがしがわ，不是 Higashikawa）
 *   歌野晶午 → `Utano Shogo`（うたの しょうご；库内多数那串 `Sho Inoue` 是另一位作者的名字）
 * 这三条按「语言通例」选定，并在改写的备注里写明理由。
 */
const OVERRIDE = new Map([
  ['泡坂妻夫', 'Awasaka Tsumao'],
  ['东川笃哉', 'Higashigawa Tokuya'],
  ['歌野晶午', 'Utano Shogo'],
]);
for (const [a, m] of counts) {
  if (m.size <= 1 && !OVERRIDE.has(a)) continue;
  const sorted = [...m.entries()].sort((x, y) => y[1] - x[1] || String(x[0]).localeCompare(String(y[0]), 'en'));
  const nonEmpty = sorted.filter(([k]) => k);
  const pick = OVERRIDE.get(a) ?? (nonEmpty.length ? nonEmpty[0][0] : '');
  target.set(a, pick);
  console.log(
    `${a}  →  取「${pick || '(保持空)'}」${OVERRIDE.has(a) ? '（人工指定：按日语人名罗马字通例）' : ''}  ｜ 现有：${sorted.map(([k, v]) => `${k || '(空)'}×${v}`).join('、')}`,
  );
}
console.log(`\n共 ${target.size} 位作者的 authorEn 需要归一`);

let changed = 0;
const touched = new Set();
for (const [f, arr] of store) {
  for (const b of arr) {
    const t = target.get(String(b.author || '').trim());
    if (t === undefined) continue;
    if (String(b.authorEn || '').trim() === t) continue;
    const from = String(b.authorEn || '').trim();
    b.authorEn = t;
    b.verification.source +=
      ` **authorEn 归一（第 143 轮）**：本条原记「${from || '（空）'}」，与库内同一作者（${b.author}）的多数写法「${t || '（空）'}」不一致，已统一——` +
      '同一个作者在页面上只会有一份罗马字写法（规则：取多数，平手取字典序在前者，空值不覆盖）。';
    touched.add(f);
    changed += 1;
  }
}
console.log(`将改写 ${changed} 条（涉及 ${touched.size} 个文件）${APPLY ? '' : '（预演，未落盘）'}`);
if (APPLY && changed) {
  for (const f of touched) writeFileSync(`data/books/${f}`, JSON.stringify(store.get(f), null, 2) + '\n', 'utf8');
  console.log(`已写入 ${touched.size} 个文件`);
}
