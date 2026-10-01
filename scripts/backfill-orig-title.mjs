#!/usr/bin/env node
/**
 * 原作名回填（豆瓣条目页）
 * ======================
 * **为什么要有这个脚本**：§148–§163 那几十轮里豆瓣一直不可达（登录跳转），于是新收的
 * 日译本／欧美本一律**把 `originalTitle` 留空**（按规矩：查不到就不冒填）。§164 实测豆瓣**已恢复**
 * （条目页 200 且能取到 `rating_num`），原作名这一栏就可以回填了。
 *
 * **两条硬规矩**（与取评分时同一套）：
 *   1. **评分／原作名必须与所引版本同一条**——所以优先用**强链接**：知识库里该条的
 *      `ratings.douban.subjectId` 就是当初取评分的那条豆瓣条目，直接抓它，不另搜；
 *   2. **不覆盖已有值**、**不猜**：只有条目页的「原作名」栏确实有值才写；写不出就照旧留空并报告。
 *
 * 分组：
 *   · **A 组（强链接）**：`originalTitle` 为空、`country !== '中国'`、且有 `ratings.douban.subjectId`；
 *   · **B 组（弱链接）**：`originalTitle` 为空、`country !== '中国'`、没有 subjectId——
 *     按书名走 `j/subject_suggest` 找候选，**要求候选书名与库内题名一致**才取；报告里标明「弱链接」。
 *   · 中国原创（`country === '中国'`）**一律跳过**：中文原创没有「原作名」。
 *
 * 用法：
 *   node scripts/backfill-orig-title.mjs [--limit N] [--delay 1200] [--group A|B|all] [--apply]
 *   （默认干跑：只打印将要填入的值与来源，不写库）
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i === -1 ? d : argv[i + 1];
};
const APPLY = argv.includes('--apply');
const LIMIT = Number(arg('--limit', '0')) || Infinity;
const DELAY = Number(arg('--delay', '1200'));
const GROUP = arg('--group', 'all');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 从条目页 info 块抽「原作名」与「ISBN」 */
export function parseInfoFields(html) {
  const src = String(html || '');
  const grab = (label) => {
    const re = new RegExp(`<span class="pl">\\s*${label}[:：]?\\s*</span>\\s*([\\s\\S]{0,200}?)(?:<br|</div)`, 'i');
    const m = src.match(re);
    if (!m) return '';
    return m[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };
  const titleM = src.match(/<span[^>]*property="v:itemreviewed"[^>]*>([\s\S]*?)<\/span>/i);
  return {
    title: titleM ? titleM[1].replace(/<[^>]+>/g, '').trim() : '',
    originalTitle: grab('原作名'),
    isbn: grab('ISBN'),
    publisher: grab('出版社'),
    year: grab('出版年'),
  };
}

const files = readdirSync('data/books').filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const store = new Map();
for (const f of files) store.set(f, JSON.parse(readFileSync(`data/books/${f}`, 'utf8')));

const norm = (s) => String(s || '').replace(/[\s\u3000《》〈〉·・:：,，.。、\-—－_/\\|()（）[\]【】「」『』!！?？"'“”‘’]/g, '').toLowerCase();

const targets = [];
for (const [f, arr] of store) {
  for (const b of arr) {
    if (String(b.originalTitle || '').trim()) continue;
    if (b.country === '中国') continue;
    const sid = b.ratings?.douban?.subjectId;
    const group = sid ? 'A' : 'B';
    if (GROUP !== 'all' && GROUP !== group) continue;
    targets.push({ file: f, b, group, sid });
  }
}
console.log(`待回填原作名的条目 ${targets.length} 条（A 组强链接 ${targets.filter((t) => t.group === 'A').length} ／ B 组弱链接 ${targets.filter((t) => t.group === 'B').length}）`);

const filled = [];
const skipped = [];
let n = 0;
for (const t of targets) {
  if (n >= LIMIT) break;
  n += 1;
  let sid = t.sid;
  let weak = false;
  try {
    if (!sid) {
      // B 组：按书名找候选，要求候选书名与库内题名一致
      const j = await (await fetch(`https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(t.b.title)}`, {
        headers: { 'user-agent': UA, accept: 'application/json' },
      })).text();
      let cands = [];
      try {
        cands = JSON.parse(j);
      } catch {
        cands = [];
      }
      const hit = (Array.isArray(cands) ? cands : []).find((c) => norm(c.title) === norm(t.b.title));
      if (!hit) {
        skipped.push(`${t.b.title}｜B 组：检索无同名候选`);
        await sleep(DELAY);
        continue;
      }
      sid = hit.id;
      weak = true;
    }
    const html = await (await fetch(`https://book.douban.com/subject/${sid}/`, { headers: { 'user-agent': UA } })).text();
    const info = parseInfoFields(html);
    if (!info.originalTitle) {
      skipped.push(`${t.b.title}｜条目 ${sid}：「原作名」栏为空`);
    } else {
      filled.push({ ...t, sid, weak, info });
    }
  } catch (e) {
    skipped.push(`${t.b.title}｜抓取失败：${e.message}`);
  }
  await sleep(DELAY);
  if (n % 20 === 0) console.log(`  … 已处理 ${n} 条（命中 ${filled.length}）`);
}

console.log(`\n命中「原作名」${filled.length} 条；跳过 ${skipped.length} 条`);
for (const f of filled.slice(0, 30)) {
  console.log(`  ${f.weak ? '（弱）' : '（强）'}《${f.b.title}》${f.b.author} → 原作名「${f.info.originalTitle}」 ｜ 条目 ${f.sid} ｜ ISBN ${f.info.isbn || '—'} ｜ ${f.info.year || ''}`);
}
if (skipped.length) {
  console.log('\n跳过的前 12 条：');
  for (const s of skipped.slice(0, 12)) console.log(`  · ${s}`);
}

if (!APPLY) {
  console.log('\n这是干跑。确认无误后加 --apply 写回。');
  process.exit(0);
}

const touched = new Set();
for (const f of filled) {
  const arr = store.get(f.file);
  const b = arr.find((x) => x.id === f.b.id);
  if (!b) continue;
  b.originalTitle = f.info.originalTitle;
  const note = ` **原作名回填（第 165 轮）**：豆瓣条目页 \`https://book.douban.com/subject/${f.sid}/\`（ISBN ${f.info.isbn || '—'}${f.info.year ? `，${f.info.year}` : ''}）的「原作名」栏给出 \`${f.info.originalTitle}\`，据此回填。**同版判据**：${f.weak ? '按**书名**检索到同名候选条目（弱链接，未见 ISBN 佐证）' : '该条目 id 即本库取评分时所用的那一条（强链接，评分与所引版本同一条）'}。`;
  b.verification = b.verification || {};
  b.verification.source = String(b.verification.source || '') + note;
  touched.add(f.file);
}
for (const file of touched) writeFileSync(`data/books/${file}`, JSON.stringify(store.get(file), null, 2) + '\n', 'utf8');
console.log(`\n✓ 已写回 ${filled.length} 条，涉及 ${touched.size} 个文件`);
console.log('建议接着运行：node scripts/find-duplicates.mjs --strict 与 node scripts/check-data.mjs');
