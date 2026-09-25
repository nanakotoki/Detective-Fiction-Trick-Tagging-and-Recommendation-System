#!/usr/bin/env node
/**
 * 合并重复条目（维护工具）
 * ======================
 * 背景：数据文件是分批写入的，不同批次各自独立抓过同一部作品，于是库里
 * 出现了**同一部书的两个条目**。重复条目同时污染三件事：
 *   1. 作品总数与「按作者收全」的进度统计被虚高；
 *   2. 推荐结果里可能出现同一部书的两个条目（「每位作者最多 2 部」拦不住）；
 *   3. 同一部书的标签被拆到两条记录上，重叠度计算偏低。
 *
 * 判定（并查集连通）：
 *   A. 两边 originalTitle 都非空且归一化后**完全相等** → 同一部作品。
 *      这一条能抓住「异名同书」：《生ける屍の死》既有《活尸之死》也有《生尸之死》，
 *      《球形の荒野》既有《球形的荒野》也有《一个背叛日本的日本人》。
 *   B. 归一化书名完全相等 → 同一部作品（用于原书名缺失/两边都没写的情况）。
 *
 *   ⚠️ 故意**不使用**「原书名互为包含」——那条规则会把同一系列的相邻各卷
 *   （《巷说百物语》/《后巷说百物语》、《思考机器探案集之幽灵汽车》/《…微笑的上帝》、
 *   《连续"杀人鬼"青蛙男》/《…噩梦再临》）误判成重复。系列各卷是独立作品。
 *
 * 保留哪一条（survivor）按打分，分高者胜：
 *   豆瓣有评分 > 字段完整度 > 标签数 > 豆瓣评价人数 > 文件先后。
 *
 * 合并动作：
 *   · tags / school 取并集，并按 tags.js 的规范顺序重排；
 *   · ratings 逐平台取「有分者」，两边都有分时取评价人数多的；
 *   · 标量字段（原作名/首版年/系列/侦探/作者…）单边有值时互相补齐；
 *   · **落选一方的中文书名进入 alternateTitles**，前端搜索与详情页会展示，
 *     这样用旧译名/台版名来搜也能找到这本书；
 *   · safeSummary、readingTips 一律保留 survivor 原文，绝不自动拼接——
 *     梗概是人工撰写并过了泄底闸门的，自动合并会产生未经审核的文本；
 *   · vault 必须两侧全空，否则拒绝合并（防止把私密数据卷进来）。
 *
 * 用法：
 *   node scripts/merge-dups.mjs            预演，只打印将要执行的动作
 *   node scripts/merge-dups.mjs --apply    实际写入
 *   node scripts/merge-dups.mjs --json     输出机器可读结果
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAGS } from '../web/js/core/tags.js';
import {
  AUTHOR_ALIASES,
  authorsCompatible,
  looksLikeCollectionName,
  normText,
} from './lib/dup-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_DIR = path.resolve(__dirname, '..', 'data', 'books');
const TOMB_DIR = path.join(BOOKS_DIR, '_merged');

const APPLY = process.argv.includes('--apply');
const AS_JSON = process.argv.includes('--json');

const TAG_ORDER = new Map(TAGS.map((t, i) => [t.id, i]));
const sortTags = (ids) => [...new Set(ids.filter(Boolean))].sort((a, b) => (TAG_ORDER.get(a) ?? 999) - (TAG_ORDER.get(b) ?? 999));

const vaultEmpty = (v) => !v || typeof v !== 'object' || Object.values(v).every((x) => !String(x || '').trim());

const RATING_SOURCES = ['douban', 'goodreads', 'hupu'];

/**
 * 主条目择优：返回可比较的**元组**，而不是加权总分。
 * 加权总分在这里会出错——字段完整度的权重一旦调大，就会压过
 * 评价人数的差距（《球形的荒野》2716 人 vs《一个背叛日本的日本人》1853 人，
 * 863 人的差距被一个「多填了 detective 字段」抵掉，主条目就选错了）。
 * 元组逐项比较则不会互相干扰。
 *
 * 顺序：有豆瓣评价人数 > 人数多 > 字段完整 > 标签多 > 有评分 > 文件名
 * ——「中文读者实际看到的那一版」才是通行版本，应当作为主条目。
 */
const COMPLETENESS_FIELDS = ['originalTitle', 'firstPublished', 'series', 'detective', 'authorEn', 'genre', 'country'];

function rankOf(b, file) {
  const d = (b.ratings || {}).douban || {};
  const count = Number(d.count) || 0;
  return [
    count > 0 ? 1 : 0,
    count,
    COMPLETENESS_FIELDS.filter((k) => String(b[k] ?? '').trim()).length,
    (b.tags || []).length + (b.school || []).length,
    d.score != null ? 1 : 0,
    // 文件名升序：同分时取更早的批次，保持稳定
    file,
  ];
}

/** 元组降序比较（最后一项文件名升序） */
function compareRank(a, b) {
  for (let i = 0; i < 5; i += 1) {
    if (a[i] !== b[i]) return b[i] - a[i];
  }
  return a[5] < b[5] ? -1 : a[5] > b[5] ? 1 : 0;
}

function mergeRatings(a, b) {
  const out = { ...(a || {}) };
  for (const key of RATING_SOURCES) {
    const ra = out[key];
    const rb = (b || {})[key];
    if (!rb) continue;
    if (!ra || ra.score == null) out[key] = rb;
    else if (rb.score != null && (Number(rb.count) || 0) > (Number(ra.count) || 0)) out[key] = rb;
  }
  return out;
}

function main() {
  const files = fs
    .readdirSync(BOOKS_DIR)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .sort();

  const store = new Map();
  const nodes = []; // {file, index, book}
  let total = 0;

  for (const f of files) {
    let list;
    try {
      list = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, f), 'utf8'));
    } catch (e) {
      console.error(`  ✗ ${f} 解析失败：${e.message}`);
      process.exit(1);
    }
    if (!Array.isArray(list)) continue;
    store.set(f, list);
    list.forEach((b, i) => {
      total++;
      nodes.push({ file: f, index: i, book: b });
    });
  }

  // ---- 并查集 ----
  const parent = nodes.map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  /** 原书名 → 首个节点下标；书名 → 首个节点下标 */
  const byOrig = new Map();
  const byTitle = new Map();
  nodes.forEach((n, i) => {
    const o = normText(n.book.originalTitle);
    if (o) {
      const prev = byOrig.get(o);
      if (prev != null && authorsCompatible(nodes[prev].book.author, n.book.author)) union(prev, i);
      else if (prev == null) byOrig.set(o, i);
    }
    const t = normText(n.book.title);
    if (t) {
      const prev = byTitle.get(t);
      if (prev != null && authorsCompatible(nodes[prev].book.author, n.book.author)) union(prev, i);
      else if (prev == null) byTitle.set(t, i);
    }
  });

  // ---- 收集连通分量 ----
  const comps = new Map();
  nodes.forEach((n, i) => {
    const r = find(i);
    if (!comps.has(r)) comps.set(r, []);
    comps.get(r).push(n);
  });

  const applied = [];
  const skipped = [];
  const removed = new Set();
  /** 有记录被合并结果改写的文件（赢家所在文件，可能一条都没删） */
  const dirty = new Set();

  for (const [, recsRaw] of comps) {
    if (recsRaw.length < 2) continue;

    // 选集名守卫：若一个连通分量有 3 条以上、且各条中文书名**全不相同**，
    // 那多半是 originalTitle 被填成了「选集名 / 系列名」而不是各卷自己的原名
    // （《思考机器探案集》四卷共用 `The Thinking Machine` 就是这种情况）。
    // 系列各卷是独立作品，绝不能合并——交人工处理。
    if (looksLikeCollectionName(recsRaw.map((r) => r.book))) {
      skipped.push({ title: recsRaw[0].book.title, reason: '三条以上、书名互不相同：原作名疑似选集名/系列名，请先核对 originalTitle', recs: recsRaw });
      continue;
    }

    const recs = [...recsRaw].sort(
      (a, b) => compareRank(rankOf(a.book, a.file), rankOf(b.book, b.file))
    );

    if (recs.some((r) => !vaultEmpty(r.book.vault))) {
      skipped.push({ title: recs[0].book.title, reason: 'vault 非空，拒绝自动合并', recs });
      continue;
    }

    const keep = recs[0];
    const drop = recs.slice(1);

    const merged = { ...keep.book };
    merged.tags = sortTags(recs.flatMap((r) => r.book.tags || []));
    merged.school = sortTags(recs.flatMap((r) => r.book.school || []));
    merged.ratings = recs.reduce((acc, r) => mergeRatings(acc, r.book.ratings), {});
    for (const f of ['originalTitle', 'firstPublished', 'series', 'detective', 'authorEn', 'author', 'genre', 'country']) {
      if (!String(merged[f] ?? '').trim()) {
        const donor = recs.find((r) => String(r.book[f] ?? '').trim());
        if (donor) merged[f] = donor.book[f];
      }
    }
    merged.author = AUTHOR_ALIASES[normText(merged.author)] || merged.author;

    // 落选的中文书名保留为「又名」，搜索与详情页都能命中
    const alt = [
      ...(keep.book.alternateTitles || []),
      ...recs.flatMap((r) => [r.book.title, ...(r.book.alternateTitles || [])]),
    ].filter((t) => t && t !== merged.title);
    merged.alternateTitles = [...new Set(alt)];

    merged.provenance = {
      ...(keep.book.provenance || {}),
      mergedFrom: drop.map((d) => `${d.file}#${d.book.id}`),
      mergedAt: new Date().toISOString().slice(0, 7),
      mergeNote:
        '本条由重复条目合并而来：标签与流派取并集，评分逐平台取较新的一条，梗概与阅读提示保留主条目原文；另一版本的中文书名保留在 alternateTitles 中，搜索仍可命中。',
    };

    store.get(keep.file)[keep.index] = merged;
    dirty.add(keep.file);
    for (const d of drop) removed.add(`${d.file}\u0000${d.index}`);

    applied.push({
      title: merged.title,
      alternateTitles: merged.alternateTitles,
      author: merged.author,
      keep: `${keep.file}#${keep.book.id}`,
      drop: drop.map((d) => `${d.file}#${d.book.id}（${d.book.title}）`),
      tagsBefore: keep.book.tags?.length ?? 0,
      tagsAfter: merged.tags.length,
      schoolAfter: merged.school.length,
    });
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ applied, skipped, total, after: total - removed.size }, null, 2));
  } else {
    console.log('');
    console.log('  重复条目合并');
    console.log('  ────────────────────────────────────────────');
    console.log(`  扫描 ${files.length} 个文件 / ${total} 部作品`);
    console.log('');
    if (!applied.length) console.log('  ✓ 未发现可合并的重复条目');
    for (const a of applied) {
      console.log(`  ▸ ${a.title}（${a.author}）`);
      console.log(`      保留 ${a.keep}`);
      for (const d of a.drop) console.log(`      删除 ${d}`);
      if (a.alternateTitles.length) console.log(`      又名 ${a.alternateTitles.join(' / ')}`);
      console.log(`      标签 ${a.tagsBefore} → ${a.tagsAfter} 个（并集），流派 ${a.schoolAfter} 个`);
    }
    for (const s of skipped) {
      console.log('');
      console.log(`  ! 跳过：${s.title} —— ${s.reason}`);
    }
    console.log('');
    console.log(`  可合并 ${applied.length} 组，跳过 ${skipped.length} 组`);
    console.log(
      `  ${APPLY ? '已写入' : '预演模式（未写入，加 --apply 执行）'}：合并后全库 ${total - removed.size} 部`
    );
    console.log('');
  }

  if (!APPLY) return;

  let touched = 0;
  for (const [f, list] of store) {
    /**
     * ⚠️ 判断「要不要写」不能只看这个文件有没有**删掉**记录。
     *
     * 合并的两条记录常常分处不同文件：保留 A 文件里的条目、删掉 B 文件里的条目。
     * 若按「有删除才写」判断，A 文件因为一条都没删就被跳过——赢家那条
     * **永远拿不到合并结果**：标签并集没生效，alternateTitles 与 mergedFrom
     * 溯源全部丢失，而脚本照样报「合并成功」。
     * （实际发生过：4 个只当赢家的文件被跳过，11 部书丢了标签并集。）
     *
     * 所以改成：只要这个文件里有记录被改写（dirty）或被删除，就落盘。
     */
    const hasDeletion = list.some((_, i) => removed.has(`${f}\u0000${i}`));
    if (!hasDeletion && !dirty.has(f)) continue;
    const next = list.filter((_, i) => !removed.has(`${f}\u0000${i}`));
    fs.writeFileSync(path.join(BOOKS_DIR, f), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    touched++;
  }

  if (applied.length) {
    fs.mkdirSync(TOMB_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(
      path.join(TOMB_DIR, `merged-${stamp}.json`),
      `${JSON.stringify(applied, null, 2)}\n`,
      'utf8'
    );
  }

  console.log(`  ✓ 已写入 ${touched} 个文件，删除 ${removed.size} 条重复记录`);

  /* ---------------- 写后自检 ---------------- */
  // 「脚本说合并成功、实际没落盘」是这里最危险的失败模式：早期版本的写回条件
  // 只看文件有没有删记录，结果只当赢家的文件被整体跳过，11 部书静默丢掉标签并集。
  // 所以写完之后必须回读磁盘，确认每条赢家记录真的带上了 mergedFrom。
  const unverified = [];
  for (const a of applied) {
    const [file, id] = a.keep.split('#');
    try {
      const list = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, file), 'utf8'));
      const rec = list.find((b) => b.id === id);
      if (!rec) unverified.push(`${a.keep}（记录消失）`);
      else if (!rec.provenance?.mergedFrom?.length) unverified.push(`${a.keep}（缺少 mergedFrom 溯源）`);
    } catch (e) {
      unverified.push(`${a.keep}（回读失败：${e.message}）`);
    }
  }

  if (unverified.length) {
    console.error('');
    console.error(`  ✗ 写后自检未通过，有 ${unverified.length} 条赢家记录没有落盘：`);
    for (const u of unverified) console.error(`      ${u}`);
    console.error('    可运行 `node scripts/repair-merge.mjs` 依据台账回填。');
    console.error('');
    process.exit(1);
  }
  console.log(`  ✓ 写后自检通过：${applied.length} 条赢家记录均已落盘（含 mergedFrom 溯源）`);

  console.log('    台账：data/books/_merged/');
  console.log('');
}

main();
