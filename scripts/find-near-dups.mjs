/**
 * 近似重复检测（`find-near-dups`）
 * =================================
 * **为什么还需要它**：`find-duplicates.mjs` 靠**书名与原题名**精确比对，
 * 因此抓不到这几类：
 *   1. 同一部作品的两个中译名，而两条的 `originalTitle` **都是空的**——
 *      库里这类条目很多（未核实原题名时我们**故意留空**，这是既定做法），
 *      于是闸门对它们完全失明；
 *   2. 同一部作品的两个译本，书名略有出入（多一个副题、少一个「的」）；
 *   3. 同一作者同一年、同一系列的两条，其实是同一本书。
 *
 * 本脚本按「**同一位作者**」预筛，再看三条信号：
 *   - 不署原题名的**书名相似度**（字符二元组 Dice 系数）；
 *   - `safeSummary` 的相似度（书目提要若是同一版本转写，会高度重合）；
 *   - `firstPublished` / `editionYear` 的接近程度。
 * 只输出**需要人工过目**的候选，不做任何自动合并。
 */
import { loadSeedBooks, authorListOf } from '../web/js/core/seed.js';

const books = loadSeedBooks();
const norm = (s) => String(s || '').replace(/[\s:：·・,，.。()（）[\]【】\-—_=·]/g, '').toLowerCase();

/** 字符二元组集合 */
function bigrams(s) {
  const t = norm(s);
  const out = new Set();
  for (let i = 0; i + 1 < t.length; i += 1) out.add(t.slice(i, i + 2));
  return out;
}
/** Dice 系数：2|A∩B| / (|A|+|B|) */
function dice(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter += 1;
  return (2 * inter) / (a.size + b.size);
}

// 预计算 + 按作者建索引
const recs = books.map((b) => ({
  b,
  titleG: bigrams(b.title),
  sumG: bigrams(b.safeSummary),
  authors: authorListOf(b),
}));
const byAuthor = new Map();
recs.forEach((r, i) => {
  for (const a of r.authors) {
    if (!byAuthor.has(a)) byAuthor.set(a, []);
    byAuthor.get(a).push(i);
  }
});

const flags = [];
const seenPair = new Set();
for (const [, idxs] of byAuthor) {
  for (let i = 0; i < idxs.length; i += 1) {
    for (let j = i + 1; j < idxs.length; j += 1) {
      const a = idxs[i];
      const b = idxs[j];
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      const A = recs[a];
      const B = recs[b];
      // 已有原题名的，交给 find-duplicates 处理，这里不重复报
      const bothNoOriginal = !A.b.originalTitle && !B.b.originalTitle;
      const tSim = dice(A.titleG, B.titleG);
      const sSim = dice(A.sumG, B.sumG);
      const yA = A.b.firstPublished || A.b.editionYear || '';
      const yB = B.b.firstPublished || B.b.editionYear || '';
      const sameYear = yA && yB && yA === yB;
      const sameSeries = A.b.series && B.b.series && A.b.series === B.b.series;

      // **样板简介要排除**：凡「馆藏提要未提供…梗概暂缺」这类占位文案，
      // 同一作者的两条必然 100% 相似——那是模板重合，不是同一本书的证据。
      const BOILER = /梗概暂缺|未提供情节|未编造情节|未提供篇目|未提供内容/;
      const aBoiler = BOILER.test(A.b.safeSummary || '');
      const bBoiler = BOILER.test(B.b.safeSummary || '');
      const substantive = !aBoiler && !bBoiler;

      // **卷次号要剥掉再比**：同一套书的不同卷次（《乱步侦探作品集.7》与「.17」、
      // 《神探夏洛克.3》与「.4」）书名天然高度相似，但**是合法的不同书目**。
      // 把数字与「第N卷/册/部」剥掉后若核心完全相同，就判定为同套不同卷，跳过。
      // 取「书名首个分隔符之前」的部分作为系列核心：这样
      //   《诱饵搜查官.1：触觉》与「.2：视觉」→ 都是「诱饵搜查官」→ 同套不同卷，跳过；
      //   《住在我隔壁的侦探.上》与「.下」→ 同理；
      //   而《格林家杀人事件》与《葛蕾丝命案》这种真正的异名 → 核心不同 → 保留待查。
      const core = (s) =>
        norm(String(s).split(/[.。：:,，;；(（\-—]/)[0])
          .replace(/第[一二三四五六七八九十百\d]+[卷册部集篇]/g, '')
          .replace(/[卷册部集篇]/g, '')
          .replace(/\d+/g, '');
      if (core(A.b.title) === core(B.b.title)) continue;

      const reasons = [];
      if (bothNoOriginal && tSim >= 0.72) reasons.push(`书名相似 ${(tSim * 100).toFixed(0)}%`);
      /**
       * **「实质简介相似」要排除「同系列同年的分册」**（第 86 轮修）。
       *
       * 起因：batch-182 收了新世界出版社「希区柯克悬念故事集」8 册，
       * 我给它们写的是**体例化的同一句梗概**（「……的一册：一辑悬念短篇」），
       * 于是这 8 册两两之间都报「实质简介相似 100%」，一口气产生 28 对噪音，
       * 把真正要看的候选淹了。
       *
       * 判据：两条**同作者 + 同系列（非空）+ 同年**，且**书名相似度很低**（<0.5），
       * 那多半是一套书的不同卷次——**梗概雷同是我自己写作体例造成的**，不是重复条目的信号。
       * 真正同书异名的两条，书名相似度通常不会这么低（或会命中下面那条「同系列同年」）。
       */
      const looksLikeSeriesVolumes = sameSeries && sameYear && tSim < 0.5;
      if (substantive && sSim >= 0.85 && !looksLikeSeriesVolumes) {
        reasons.push(`实质简介相似 ${(sSim * 100).toFixed(0)}%`);
      }
      // 「同系列同年」单独出现时太吵（同一套书的不同卷次天然满足），
      // 只有与书名相似并用才作数
      if (bothNoOriginal && sameSeries && sameYear && tSim >= 0.5) {
        /**
         * **但「书名相似」要先去掉两条的公共前缀**（第 86 轮修）。
         *
         * 起因：「三色猫福尔摩斯」系列 6 册同年出版，题名都是
         * 「三色猫福尔摩斯**××**谜案」——整串比出来的相似度轻松超过 0.5，
         * 于是同一套书的不同卷次又被两两报成候选（这次刷掉了 42 对里的绝大部分）。
         * 去掉公共前缀后只剩「密室谜案／校园谜案」，相似度落到 0.33，
         * 这类噪音即消失；而真正同书异名（题名差异在**实词**上）仍会被「书名相似」那条规则抓住。
         */
        const stripCommonPrefix = (x, y) => {
          let i = 0;
          while (i < x.length && i < y.length && x[i] === y[i]) i += 1;
          return i >= 3 ? [x.slice(i), y.slice(i)] : [x, y];
        };
        const [ra, rb] = stripCommonPrefix(norm(A.b.title), norm(B.b.title));
        if (ra && rb && dice(bigrams(ra), bigrams(rb)) >= 0.5) reasons.push(`同系列同年 ${yA}`);
      }
      if (!reasons.length) continue;
      flags.push({ A: A.b, B: B.b, tSim, sSim, reasons, bothNoOriginal, sameYear, sameSeries });
    }
  }
}
flags.sort((x, y) => Math.max(y.tSim, y.sSim) - Math.max(x.tSim, x.sSim));
console.log(`按作者预筛 ${seenPair.size} 对，其中**需要人工过目 ${flags.length} 对**\n`);
for (const f of flags.slice(0, 60)) {
  console.log(`【${f.reasons.join('；')}】`);
  console.log(`   A《${f.A.title}》${f.A.author} | 原题「${f.A.originalTitle || '（空）'}」| ${f.A.firstPublished || f.A.editionYear || '-'} | ${f.A.id}`);
  console.log(`   B《${f.B.title}》${f.B.author} | 原题「${f.B.originalTitle || '（空）'}」| ${f.B.firstPublished || f.B.editionYear || '-'} | ${f.B.id}`);
}
if (flags.length > 60) console.log(`\n…另有 ${flags.length - 60} 对未列出`);
