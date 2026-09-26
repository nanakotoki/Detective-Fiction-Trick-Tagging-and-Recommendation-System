#!/usr/bin/env node
/**
 * 收书前的「原作名」交叉比对 `origtitle-crosscheck`
 * =================================================
 * 起因（台账 §107.5）：本项目最怕的重复，是**同一部作品换了个中文译名**——
 * `find-duplicates.mjs` 要求「作者＋题名（或原题）同时对得上」，
 * 而候选一侧的原题一栏通常是空的，所以这类重复它**一条都拦不住**：
 * §97 拦下 11 条、§99 两条、§101 三条，全靠人把候选与库内条目逐条对读。
 *
 * 2026-09 豆瓣桌面站恢复后，条目页的「**原作名**」一栏重新可取（移动版没有这个字段）。
 * 本工具就把它当探针：**候选在豆瓣的原作名 → 与库内各条的 `originalTitle` 对撞**，
 * 一次给出四种判定：
 *
 *   · `已收`      —— 候选题名（或豆瓣题名）已在库内（含别名），不必再收；
 *   · `疑同书异名` —— 原作名与库内某条一致 → 应登记别名，**不另立条目**；
 *   · `新书候选`  —— 原作名明确且库内没有 → 可进入下一道取证（上图 CNMARC + 简介）；
 *   · `待核`      —— 豆瓣没命中、或条目页**没有原作名** → 既不能收也不能判重，交人工。
 *
 * ⚠️ 三条口径：
 *   1. **原作名只用来判重，不用来写数据**——落库的 `originalTitle` 仍以馆藏 `510`/`200$d` 为准；
 *   2. **题名近似不算命中**（§98.2 的教训）：题名只有「完全相等」才认，
 *      近似（互相包含）必须作者也对得上，且判定降一档为 `待核`；
 *   3. 只读：不写任何数据文件，输出 TSV 供人工过目。
 *
 * 用法：
 *   node scripts/origtitle-crosscheck.mjs --author 绫辻行人 --file _dd/ayatsuji.txt
 *   node scripts/origtitle-crosscheck.mjs --author G·K·切斯特顿 布朗神父的怀疑 布朗神父的丑闻
 *   node scripts/origtitle-crosscheck.mjs --file _dd/pairs.tsv --out _dd/otc.tsv --delay 1800
 *   文件格式：每行 `作者<TAB>题名`，或（配合 --author）每行一个题名。
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { normText, normAuthor } from './lib/dup-rules.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 参数 ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const AUTHOR = opt('--author', '');
const FILE = opt('--file', '');
const OUT = opt('--out', '_dd/origtitle-crosscheck.tsv');
const DELAY = Number(opt('--delay', '1800'));
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--author' && argv[i - 1] !== '--file' && argv[i - 1] !== '--out' && argv[i - 1] !== '--delay');

// ── 候选 ──────────────────────────────────────────────────────────
const pairs = [];
if (FILE) {
  for (const line of readFileSync(FILE, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const [a, b] = s.includes('\t') ? s.split('\t') : [AUTHOR, s];
    pairs.push({ author: (a || AUTHOR).trim(), title: (b || '').trim() });
  }
}
for (const t of positional) pairs.push({ author: AUTHOR, title: t });
if (!pairs.length) {
  console.log('\n  用法：node scripts/origtitle-crosscheck.mjs --author <作者> --file <名单> | <题名…>\n');
  process.exit(1);
}

// ── 知识库索引 ────────────────────────────────────────────────────
const dbBooks = [];
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  const arr = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  if (!Array.isArray(arr)) continue;
  for (const b of arr) dbBooks.push({ ...b, _file: f });
}
const byTitle = new Map();
const byOrig = new Map();
for (const b of dbBooks) {
  for (const t of [b.title, ...(b.alternateTitles || [])]) {
    const k = normText(t);
    if (k && !byTitle.has(k)) byTitle.set(k, b);
  }
  const o = normText(b.originalTitle);
  if (o && !byOrig.has(o)) byOrig.set(o, b);
}
const lookupTitle = (t) => {
  const k = normText(t);
  if (!k) return null;
  if (byTitle.has(k)) return { book: byTitle.get(k), how: '题名或别名完全相等' };
  if (k.length >= 4) {
    for (const [dk, b] of byTitle) if (dk.length >= 4 && (dk.includes(k) || k.includes(dk))) return { book: b, how: '题名互相包含' };
  }
  return null;
};

// ── 豆瓣：检索 + 条目页 ───────────────────────────────────────────
async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://book.douban.com/' }, signal: AbortSignal.timeout(20000) });
  return { status: r.status, text: await r.text() };
}
const strip = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function suggest(title) {
  const { status, text } = await get(`https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(title)}`);
  if (status !== 200) return { status, list: [] };
  try {
    return { status, list: JSON.parse(text) };
  } catch {
    return { status, list: [] };
  }
}

/** 条目页 info 区块的字段：`<span class="pl">原作名:</span> … 值` */
function infoFields(html) {
  const block = html.match(/<div id="info"[^>]*>([\s\S]*?)<\/div>/);
  const raw = block ? block[1] : '';
  const out = {};
  for (const part of raw.split(/<span class="pl">/).slice(1)) {
    const label = strip((part.match(/^([\s\S]*?)<\/span>/) || ['', ''])[1]).replace(/[:：]\s*$/, '');
    const value = strip((part.match(/<\/span>([\s\S]*)$/) || ['', ''])[1]).split(/<span class="pl">/)[0];
    if (label) out[label] = value.replace(/^[:：]\s*/, '');
  }
  return {
    fields: out,
    rating: strip((html.match(/<strong class="ll rating_num"[^>]*>([\s\S]*?)<\/strong>/) || ['', ''])[1]),
    votes: strip((html.match(/<span property="v:votes">([\s\S]*?)<\/span>/) || ['', ''])[1]),
  };
}

// ── 主流程 ────────────────────────────────────────────────────────
const rows = [];
console.log(`候选 ${pairs.length} 条；库内 ${dbBooks.length} 部（含原题名 ${byOrig.size} 个）\n`);
for (const [i, p] of pairs.entries()) {
  if (i) await sleep(DELAY);
  const rec = { author: p.author, title: p.title, dbTitle: '', dbHow: '', dbOriginal: '', doubanId: '', doubanTitle: '', doubanYear: '', doubanPub: '', doubanOriginal: '', doubanScore: '', doubanVotes: '', verdict: '', note: '' };

  // ① 库内题名先比一次（不发请求，省一半）
  const local = lookupTitle(p.title);
  if (local && local.how === '题名或别名完全相等') {
    rec.verdict = '已收';
    rec.dbTitle = local.book.title;
    rec.dbHow = local.how;
    rows.push(rec);
    console.log(`✗ 已收      《${p.title}》→ 库内《${local.book.title}》（题名或别名）`);
    continue;
  }

  // ② 豆瓣检索
  const sug = await suggest(p.title);
  const exact = sug.list.find((x) => normText(x.title) === normText(p.title));
  const loose = sug.list.find(
    (x) =>
      (normText(x.title).includes(normText(p.title)) || normText(p.title).includes(normText(x.title))) &&
      normText(x.author_name).includes(normAuthor(p.author).slice(0, 3)),
  );
  const hit = exact || loose;
  if (!hit) {
    rec.verdict = local ? '待核' : '待核';
    rec.note = sug.list.length ? `豆瓣 ${sug.list.length} 条建议，题名无一吻合` : '豆瓣无建议';
    if (local) {
      rec.dbTitle = local.book.title;
      rec.dbHow = local.how;
      rec.note += `；库内有近似题名《${local.book.title}》（${local.how}）`;
    }
    rows.push(rec);
    console.log(`? 待核      《${p.title}》｜${rec.note}`);
    continue;
  }
  rec.doubanId = hit.id;
  rec.doubanTitle = hit.title;
  rec.doubanYear = hit.year;

  // ③ 条目页取「原作名」
  const page = await get(`https://book.douban.com/subject/${hit.id}/`);
  if (page.status === 200) {
    const { fields, rating, votes } = infoFields(page.text);
    rec.doubanOriginal = fields['原作名'] || '';
    rec.doubanPub = fields['出版社'] || '';
    rec.doubanYear = fields['出版年'] || rec.doubanYear;
    rec.doubanScore = rating;
    rec.doubanVotes = votes;
  }

  // ④ 判定
  const origKey = normText(rec.doubanOriginal);
  const origHit = origKey ? byOrig.get(origKey) : null;
  const titleHit = lookupTitle(rec.doubanTitle) || local;
  if (titleHit && titleHit.how === '题名或别名完全相等') {
    rec.verdict = '已收';
    rec.dbTitle = titleHit.book.title;
    rec.dbHow = titleHit.how;
  } else if (origHit) {
    rec.verdict = '疑同书异名';
    rec.dbTitle = origHit.title;
    rec.dbOriginal = origHit.originalTitle;
    rec.dbHow = '原作名与库内一致';
  } else if (titleHit) {
    rec.verdict = '待核';
    rec.dbTitle = titleHit.book.title;
    rec.dbHow = titleHit.how;
    rec.note = '题名近似但原作名对不上（或豆瓣未给原作名）';
  } else if (origKey) {
    rec.verdict = '新书候选';
    rec.note = `原作名 ${rec.doubanOriginal}`;
  } else {
    rec.verdict = '待核';
    rec.note = '豆瓣条目页没有「原作名」一栏';
  }
  rows.push(rec);
  const mark = { 已收: '✗', 疑同书异名: '≠', 新书候选: '✓', 待核: '?' }[rec.verdict];
  console.log(
    `${mark} ${rec.verdict.padEnd(5)} 《${p.title}》｜豆瓣 ${rec.doubanId} ${rec.doubanYear} ${rec.doubanPub}` +
      `${rec.doubanOriginal ? `｜原作名 ${rec.doubanOriginal}` : '｜（无原作名）'}` +
      `${rec.dbTitle ? ` → 库内《${rec.dbTitle}》` : ''}${rec.note && rec.verdict !== '新书候选' ? `｜${rec.note}` : ''}`,
  );
}

const head = ['候选作者', '候选题名', '判定', '库内题名', '判定依据', '库内原作名', '豆瓣id', '豆瓣题名', '豆瓣出版年', '豆瓣出版社', '豆瓣原作名', '豆瓣评分', '豆瓣人数', '备注'];
writeFileSync(OUT, [head.join('\t'), ...rows.map((r) => [r.author, r.title, r.verdict, r.dbTitle, r.dbHow, r.dbOriginal, r.doubanId, r.doubanTitle, r.doubanYear, r.doubanPub, r.doubanOriginal, r.doubanScore, r.doubanVotes, r.note].join('\t'))].join('\n') + '\n', 'utf8');

const count = (v) => rows.filter((r) => r.verdict === v).length;
console.log(`\n已收 ${count('已收')}｜疑同书异名 ${count('疑同书异名')}｜新书候选 ${count('新书候选')}｜待核 ${count('待核')}`);
console.log(`写入 ${OUT}`);
