#!/usr/bin/env node
/**
 * 主图换回「与库内题名一致」的那一版（第 180 轮·D 线）
 * ==================================================
 * 用户要求是「**尽量选更新版本的封面**」。这条要求被实现成了两处：
 *   · `--prefer-newest`（§168）：**要求题名吻合**才认新版，所以繁体／外文版顶不掉简体版；
 *   · `--editions`（§169）挑主图时却是**按出版年降序取第一条**，**没有题名与语言过滤**。
 *
 * 结果就是外面显示的「最新版」经常是泰文版、俄文版、韩文版、日文版或繁体版：
 * 《占星术杀人魔法》挂的是**泰文封面**、《点与线》挂的是英文版《Tokyo Express》、
 * 《坏小孩》挂的是俄文版——而**库里的书是中文书**。README §168 明写
 * 「不会拿繁体版／外文版顶掉简体版」，实现与文档对不上。
 *
 * 处理原则（**不新增判据，只是把已写明的规则补上**）：
 *   1. 只有当主图那一版的题名**与库内题名对不上**时才动（`sameTitleEdition()` 正面判据：
 *      繁简、数字写法、虚词增减都归一，所以《點與線》↔《点与线》算同一题名，
 *      而《ฆาตกรรมจักรราศีเลือด》不算）；
 *   2. 换的目标**必须已经在版本一览里**（说明它确实是这部作品的一版，不是新找来的），
 *      优先「本库所收」那一版，其次同年的那一版，再其次最新的那一版；
 *   3. 只换**图片文件与主图字段**，被换下的那一版**降为其他版本**留在版本一览里
 *      （题名、年份、条目 id、图片全都留着）——**没有任何信息被丢掉**；
 *   4. 换下的记进 `promotedFrom`（附原题名／年份／条目 id 与理由），可回滚。
 *
 * 用法：
 *   node scripts/promote-matching-edition.mjs            干跑：报出会换哪 65 部
 *   node scripts/promote-matching-edition.mjs --apply    真换（改文件与台账）
 *   node scripts/promote-matching-edition.mjs --limit 10 --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isTraditionalTitle, sameTitleEdition } from './lib/covers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const COVERS_DIR = path.join(ROOT, 'web', 'covers');
const INDEX_FILE = path.join(ROOT, 'data', 'covers.json');

const APPLY = process.argv.includes('--apply');
const argv = process.argv.slice(2);
const LIMIT = Number(argv[argv.indexOf('--limit') + 1]) || 0;

const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', green: '\u001b[32m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
const books = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'data', 'books'))) {
  if (!f.endsWith('.json') || f.startsWith('_')) continue;
  for (const b of JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'books', f), 'utf8'))) books.set(b.id, b);
}

const extOf = (file) => (String(file || '').match(/\.(webp|jpg|jpeg|png)$/i) || ['.webp'])[0];
const exists = (file) => Boolean(file) && fs.existsSync(path.join(COVERS_DIR, file));

const year = (v) => String(v || '').match(/\d{4}/)?.[0] || '';

/** 组装一份「与库内题名一致」的候选排序：简体优先 > 本库所收 > 同年 > 最新 */
function pickAlt(rec, book) {
  const all = (rec.editions || []).filter((e, i) => i > 0 && e.title && sameTitleEdition(book.title, e.title) && exists(e.file));
  if (!all.length) return null;
  /**
   * 简体优先：用户要的是「更新版本」，而 README §168 另有一条「不拿繁体版顶掉简体版」。
   * 两条合起来 = **在同一题名、同一文字的候选里挑最新**。只有繁体可挑时才用繁体
   * （那也比外文版强），这一条在台账里记了 `promotedFrom`，随时可回看。
   */
  const simplified = all.filter((e) => !isTraditionalTitle(e.title));
  const alts = simplified.length ? simplified : all;
  const byCollected = alts.find((e) => e.collected);
  if (byCollected) return byCollected;
  const bookYear = year(book.editionYear);
  const sameYear = bookYear ? alts.find((e) => year(e.year) === bookYear) : null;
  if (sameYear) return sameYear;
  return [...alts].sort((a, b) => Number(year(b.year) || 0) - Number(year(a.year) || 0))[0];
}

const plans = [];
for (const [id, rec] of Object.entries(index.records)) {
  const book = books.get(id);
  const cur = (rec.editions || [])[0];
  if (!book || !cur?.title || !rec.file) continue;
  const primaryMismatch = !sameTitleEdition(book.title, cur.title);
  /**
   * 两种目标：
   *   ① 主图题名与库内对不上（外文版顶了中文版）；
   *   ② 已经换过一次、但换成了繁体，而版本一览里**还有简体候选**——那就再换到简体
   *      （自我修正：第一版没把「简体优先」写进挑选规则，实测只剩这 1 部，补上）。
   */
  const betterScript = Boolean(rec.promotedFrom) && isTraditionalTitle(cur.title);
  /**
   * 第三种目标：**判据名要跟着改**。
   * 换过主图之后，主图已经不是「与评分同一条条目」或「书号直达」的那一张了，
   * 可判据还写着 `subject-id` / `isbn` —— 那行出处会**多声称一层**（链接指向的条目已不是图的那一条）。
   * 实测只有 1 部（facet127-001 原判据 `isbn`），但这种错必须当场纠，不能留给下一次。
   */
  const labelWrong =
    Boolean(rec.promotedFrom) && ['subject-id', 'subject-id+page', 'isbn', 'shlib-isbn'].includes(String(rec.matched));
  if (labelWrong) {
    plans.push({ id, rec, book, cur, alt: cur, reason: '判据名修正', labelOnly: true });
    continue;
  }
  if (!primaryMismatch && !betterScript) continue;
  const alt = pickAlt(rec, book);
  if (!alt) continue; // 版本一览里没有题名一致的一版 → 这一轮不做（要等豆瓣按题名重搜）
  if (!primaryMismatch && !isTraditionalTitle(alt.title)) plans.push({ id, rec, book, cur, alt, reason: '换成简体版' });
  else if (primaryMismatch) plans.push({ id, rec, book, cur, alt, reason: '题名对不上' });
}
const targets = LIMIT ? plans.slice(0, LIMIT) : plans;

console.log('');
console.log(color(`  主图换回题名一致的那一版：会动 ${targets.length} 部${APPLY ? '　★ --apply' : '（干跑）'}`, C.bold));
console.log(color('  只换题名对不上的一版；被换下的那一版降为「其他版本」留在版本一览里', C.dim));
console.log('');

let done = 0;
for (const { id, rec, book, cur, alt, reason, labelOnly } of targets) {
  if (labelOnly) {
    console.log(color(`    · ${id}《${book.title}》【${reason}】：判据 ${rec.matched} → editions+works（主图已换成版本一览里的一版）`, C.dim));
    if (APPLY) {
      rec.promotedFrom.oldMatched = rec.matched;
      rec.matched = 'editions+works';
      done += 1;
    }
    continue;
  }
  const oldFile = rec.file;
  const oldExt = extOf(oldFile);
  const altExt = extOf(alt.file);
  const oldSubject = String(cur.subjectId || rec.subjectId || 'unknown');
  const altSubject = String(alt.subjectId || 'unknown');
  const parkedOld = `${id}-${oldSubject}${oldExt}`; // 被换下的那一版改名成「其他版本」的规范文件名
  const line = `${id}《${book.title}》【${reason}】：主图《${cur.title}》${cur.year || ''} → 《${alt.title}》${
    alt.year || ''
  }（${alt.publisher || '出版社未记'}）`;
  console.log(color(`    · ${line}`, C.dim));
  if (!APPLY) continue;

  // ① 先把被换下的主图挪成「其他版本」的文件名（同名则跳过）
  if (exists(oldFile) && oldFile !== parkedOld) fs.renameSync(path.join(COVERS_DIR, oldFile), path.join(COVERS_DIR, parkedOld));
  // ② 把要提升的那一版挪成主图文件名
  const newPrimaryFile = `${id}${altExt}`;
  if (alt.file !== newPrimaryFile && exists(alt.file)) {
    if (exists(newPrimaryFile)) fs.rmSync(path.join(COVERS_DIR, newPrimaryFile), { force: true });
    fs.renameSync(path.join(COVERS_DIR, alt.file), path.join(COVERS_DIR, newPrimaryFile));
  }

  // ③ 台账：主图字段换成提升上来的那一版
  const oldPrimaryEntry = {
    ...cur,
    file: exists(parkedOld) ? parkedOld : oldFile,
    primary: false,
    collected: Boolean(year(cur.year) && year(book.editionYear) && year(cur.year) === year(book.editionYear)),
  };
  const newPrimaryEntry = {
    ...alt,
    file: exists(newPrimaryFile) ? newPrimaryFile : alt.file,
    primary: true,
    collected: Boolean(year(alt.year) && year(book.editionYear) && year(alt.year) === year(book.editionYear)),
  };
  const rest = (rec.editions || []).filter((e) => e !== cur && e !== alt);
  rec.editions = [newPrimaryEntry, ...rest, oldPrimaryEntry];
  rec.file = newPrimaryEntry.file;
  rec.subjectId = alt.subjectId || rec.subjectId;
  rec.sourceUrl = alt.subjectId ? `https://book.douban.com/subject/${alt.subjectId}/` : rec.sourceUrl;
  rec.edition = { title: alt.title, author: book.author, year: alt.year || '' };
  for (const k of ['bytes', 'width', 'height', 'format']) if (alt[k] !== undefined) rec[k] = alt[k];
  const by = year(book.editionYear);
  rec.yearMatch = year(alt.year) && by ? year(alt.year) === by : null;
  rec.promotedFrom = {
    title: cur.title,
    year: cur.year || '',
    subjectId: cur.subjectId || '',
    at: new Date().toISOString(),
    why: '主图原先取的是题名与库内题名对不上的一版（多为外文／繁体版，按出版年降序取的「最新」）；换成版本一览里题名一致的一版，兑现 README §168「不拿外文版顶掉中文版」',
  };
  done += 1;
}

if (APPLY) {
  if (done) {
    index.generatedAt = new Date().toISOString();
    fs.writeFileSync(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    console.log('');
    console.log(color(`  ✓ 已换 ${done} 部，台账与图片文件都已写回`, C.green));
    console.log(color('  接着跑：node scripts/dedupe-cross-book.mjs && node scripts/gen-cover-manifest.mjs && node scripts/check-covers.mjs', C.dim));
  } else {
    console.log('  没有可换的，台账未改动。');
  }
} else {
  console.log('');
  console.log('  这是干跑。确认后加 --apply。');
}
