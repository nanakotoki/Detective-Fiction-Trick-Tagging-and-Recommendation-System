#!/usr/bin/env node
/**
 * 跨书同图清理（第 177 轮·D 线）
 * ============================
 * 起因：用户提的要求只有一句——**「不要放重复的图」**。
 * 前面几轮管的是「同一部作品的多个版本之间不要同一张图」（`audit-cover-dups.mjs`），
 * 这一轮换一个问法：**两部不同的书，会不会共用同一张封面图？**
 *
 * 判据取最硬的一层——**文件字节完全相同**（sha1）。这不是阈值判断，没有误报：
 * 命中就一定是同一张图被记到了两部书上。全库实测 40 组，分成两类：
 *
 *   ① 两边的图都是**主图**（34 组）：多为「同一部作品在库里有两个条目」
 *      （《19年间谋杀小叙》／《十九年间谋杀小叙》）、或出版社**同一套设计反复用**
 *      （《中央情报局疑案》《水门疑案》《五角大楼疑案》《国会山疑案》四本同一张图）。
 *      这类**不动**——每部书都必须有自己的封面，宁可两页显示同一张，也不让任何一部空着；
 *      条目层面的重复属于收集线的账，这里只如实报出来。
 *
 *   ② 一边是**其他版本**、另一边是另一部书的图（6 组）：这条版本记录指的是**别人的书**
 *      （《女王蜂》的版本里挂着《狱门岛》的英文版，因为同作者而被收进来）。
 *      这类**要摘**——本页显示的是别的书的封面，是错，不是重复。
 *
 * 规则（只摘「其他版本」，永不摘主图）：
 *   - 同一张图（字节相同）出现在两部书里时，若其中一条是**其他版本**记录，摘掉它；
 *   - 两条都是「其他版本」时（无从判断归属）两条都摘；
 *   - 摘下的记进 `editionsDropped`（附撞上的那一部书与 sha1），**可回滚**；
 *   - 图片文件一并删除，不留孤儿。
 *
 * 用法：
 *   node scripts/dedupe-cross-book.mjs           干跑，只报告
 *   node scripts/dedupe-cross-book.mjs --apply   真摘（写回台账并删文件）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const COVERS_DIR = path.join(ROOT, 'web', 'covers');
const INDEX_FILE = path.join(ROOT, 'data', 'covers.json');

const APPLY = process.argv.includes('--apply');
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}\u001b[0m` : String(t));
const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const DIM = '\u001b[2m';
const BOLD = '\u001b[1m';

const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));

/** 知识库里的题名（封面台账本身只有一部分记录带 title，报错信息按知识库为准） */
const bookTitle = new Map();
const booksDir = path.join(ROOT, 'data', 'books');
for (const f of fs.readdirSync(booksDir)) {
  if (!f.endsWith('.json')) continue;
  const data = JSON.parse(fs.readFileSync(path.join(booksDir, f), 'utf8'));
  const list = Array.isArray(data) ? data : data.books || data.works || [];
  for (const b of list) if (b?.id) bookTitle.set(b.id, b.title || '');
}
const label = (id) => `${id}《${bookTitle.get(id) || index.records[id]?.title || '?'}》`;

/** file -> { book, kind: 'primary' | 'edition', edition } */
const owners = new Map();
for (const [id, rec] of Object.entries(index.records)) {
  if (rec.file) owners.set(rec.file, { book: id, kind: 'primary', title: rec.title || '' });
  for (const e of rec.editions || []) {
    if (e.file && !owners.has(e.file)) owners.set(e.file, { book: id, kind: 'edition', edition: e, title: e.title || '' });
  }
}

const byHash = new Map();
let files = 0;
for (const f of fs.readdirSync(COVERS_DIR)) {
  if (f === '_placeholder.svg') continue;
  const p = path.join(COVERS_DIR, f);
  if (!fs.statSync(p).isFile()) continue;
  const h = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
  files += 1;
  if (!byHash.has(h)) byHash.set(h, []);
  byHash.get(h).push({ file: f, sha1: h, ...(owners.get(f) || { book: '(未登记)', kind: '?', title: '' }) });
}

console.log('');
console.log(color(`  跨书同图清理：${files} 张本地封面，判据＝文件字节完全相同（sha1）`, BOLD));
console.log(color(`  ${APPLY ? '★ --apply：会写回台账并删除被摘的文件' : '干跑（要看结果加 --apply）'}`, DIM));
console.log('');

const primaryGroups = [];
const dropList = []; // { book, file, edition, otherBooks }
for (const [, group] of byHash) {
  if (group.length < 2) continue;
  const books = [...new Set(group.map((g) => g.book))];
  if (books.length < 2) continue; // 同一部书内部重复不归这里管（audit-cover-dups 管）
  const editions = group.filter((g) => g.kind === 'edition');
  if (!editions.length) {
    primaryGroups.push({ group, books });
    continue;
  }
  for (const e of editions) {
    dropList.push({ ...e, otherBooks: books.filter((b) => b !== e.book) });
  }
}

if (primaryGroups.length) {
  console.log(color(`  ① 两边都是主图：${primaryGroups.length} 组（不动，如实报出）`, DIM));
  for (const { books } of primaryGroups) {
    console.log(color(`     · ${books.map(label).join(' ↔ ')}`, DIM));
  }
  console.log('');
}

if (!dropList.length) {
  console.log(color('  ✓ 没有「其他版本」指向别的书的图', GREEN));
  console.log('');
  process.exit(0);
}

console.log(color(`  ② 要摘的「其他版本」：${dropList.length} 条`, RED));
for (const d of dropList) {
  console.log(`     · ${label(d.book)}摘掉版本「${d.edition?.title || '?'}${
    d.edition?.year ? ' ' + d.edition.year : ''
  }」（${d.file}）—— 这张图是 ${d.otherBooks.join('、')} 的那一版`);
}

if (!APPLY) {
  console.log('');
  console.log(color('  干跑结束：加 --apply 才真摘。', DIM));
  process.exit(0);
}

let dropped = 0;
let removedFiles = 0;
const droppedFiles = new Set();
for (const d of dropList) {
  const rec = index.records[d.book];
  if (!rec) continue;
  const kept = [];
  for (const e of rec.editions || []) {
    if (e.file === d.file) {
      rec.editionsDropped = [
        ...(rec.editionsDropped || []),
        {
          title: e.title || '',
          year: e.year || '',
          publisher: e.publisher || '',
          subjectId: e.subjectId || '',
          file: e.file,
          why: `与 ${d.otherBooks.map(label).join('、')} 的封面是同一张图（字节完全相同，sha1 ${d.sha1.slice(
            0,
            12,
          )}），本页不再重复显示`,
          sha1: d.sha1,
        },
      ];
      dropped += 1;
      droppedFiles.add(e.file);
      continue;
    }
    kept.push(e);
  }
  rec.editions = kept;
}

for (const f of droppedFiles) {
  const p = path.join(COVERS_DIR, f);
  if (fs.existsSync(p)) {
    fs.rmSync(p, { force: true });
    removedFiles += 1;
  }
}

fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2) + '\n', 'utf8');
console.log('');
console.log(color(`  ✓ 摘下 ${dropped} 条其他版本，删除 ${removedFiles} 个文件，已写回 data/covers.json`, GREEN));
console.log(color('  下一步：node scripts/gen-cover-manifest.mjs && node scripts/check-covers.mjs', DIM));
