#!/usr/bin/env node
/**
 * 封面取证体检：主图所记的那一版，真和这本书是同一部作品吗？（第 183 轮·D 线）
 * ====================================================================
 * 起因：一个小封面查出来的 —— `japan2-009《枯草之根》` 盘上那张图明明写着《枯草之根》，
 * 可台账记的版本是《桃源亭事件》（陈舜臣的**另一部小说**）。**图是对的，证据指错了地方**：
 * 档案页那行「封面：豆瓣条目 …」点进去，用户看到的是另一本书——比没有封面更糟，
 * 因为它让人以为自己核对过了。
 *
 * 判据复用评分线写好的 `looksLikeDifferentBook()`（繁简、数字写法、原书名、作者宽松匹配
 * 都已经处理过），把「封面所记的那一版」当候选、把库里的书当目标，逐条问一次。
 *
 * 输出分三类，**只读不改**：
 *   · 同一部作品：题干名对得上（含繁简／数字写法／原书名）；
 *   · ✗ 存疑：题名对不上。绝大多数是「同一部作品的外文版」（《占星术杀人魔法》挂泰文版），
 *     需要按题名重查才能确认——豆瓣 HTML 页还在限流（§179.4），所以先如实报出来；
 *   · ？ 判不了：外文题名、而库里没记原书名，无从比对。
 *
 * 用法：`node scripts/audit-edition-titles.mjs`（可复跑；也作为 `covers:finish` 的最后一步体检）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const { looksLikeDifferentBook } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'refresh-ratings.mjs')).href);
const { sameTitleEdition } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'covers.mjs')).href);

const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'covers.json'), 'utf8'));
const books = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'data', 'books'))) {
  if (!f.endsWith('.json') || f.startsWith('_')) continue;
  for (const b of JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'books', f), 'utf8'))) books.set(b.id, b);
}

const cjk = /[\u4e00-\u9fff]/;
const same = [];
const suspect = [];
const unknown = [];

for (const [id, rec] of Object.entries(index.records)) {
  const book = books.get(id);
  const ed = (rec.editions || [])[0];
  if (!book || !ed?.title) continue;
  const row = `${id}《${book.title}》← 台账记的是《${ed.title}》${ed.year || ''}（${ed.publisher || ''}）条目 ${
    rec.subjectId || '—'
  }`;
  if (sameTitleEdition(book.title, ed.title)) {
    same.push(row);
    continue;
  }
  const verdict = looksLikeDifferentBook({ title: ed.title, author: ed.author || book.author }, book);
  if (!verdict.reject) {
    same.push(row);
    continue;
  }
  if (!cjk.test(ed.title) && !book.originalTitle) unknown.push(row);
  else suspect.push(row);
}

console.log('');
console.log(`  封面取证体检：${Object.keys(index.records).length} 部有封面`);
console.log(`    ○ 同一部作品（题名对得上）：${same.length} 部`);
console.log(`    ✗ 存疑（题名对不上，多为外文版；要按题名重查才能定）：${suspect.length} 部`);
for (const s of suspect.slice(0, 12)) console.log(`      · ${s}`);
if (suspect.length > 12) console.log(`      … 其余 ${suspect.length - 12} 部省略`);
console.log(`    ？ 判不了（外文题名、库里没记原书名）：${unknown.length} 部`);
console.log('');
console.log('  说明：这一条只报不改。能自动改的那部分（版本一览里就有题名一致的一版）已经由');
console.log('        npm run covers:promote-edition 处理过（台账 §181）；剩下的要等豆瓣 HTML 页解封。');
