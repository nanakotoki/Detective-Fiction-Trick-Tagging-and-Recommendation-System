/**
 * 相似作品推荐引擎
 * ================
 * 严格遵循需求文档《知识库标签体系 → 推荐逻辑》：
 *   「优先匹配『诡计类』标签重合度，其次匹配『叙事类』与『场景类』，
 *     确保推荐作品在诡计机制层面高度相似。」
 *
 * 算法由三项融合，再加领域约束修正：
 *   1. weightedOverlap  加权重合度  —— 反映"共享了多少有价值的标签"
 *   2. jaccard          杰卡德相似度 —— 反映"整体标签画像有多像"，抑制标签堆砌
 *   3. rarityWeighted   稀有度加权重合 —— 共享冷门标签（如"童谣杀人"）比共享"都市"更有价值
 *
 * 类别权重：trick 3.0 > narrative 1.6 > scene 1.0 = motive 1.0 > theme 0.5
 * 领域约束：
 *   - 零诡计标签重合的候选，分数上限被压制（题眼是"诡计机制层面高度相似"）
 *   - **例外**：目标作品自身没有任何「诡计类」标签时，该要求无解（交集必为空），
 *     此时放宽硬约束并取消压制，同时在返回值的 `trickGate` 中如实标注，
 *     由界面明确告知读者"本次推荐不含诡计维度"——宁可说清，也不假装比对过。
 *   - 默认排除用户自建条目与禁推条目
 *   - 匹配理由由共享标签生成，保证"所说即所共享"，不产生凭空相似
 */

import { CATEGORY_MAP, CATEGORY_ORDER, CATEGORY_WEIGHT, tagCategory, tagLabel } from './tags.js';
import { RISK, analyzeRecommendation } from './safety.js';
import { sameSeries as sameSeriesShared, sharedAuthor, authorListOf } from './seed.js';

/** 默认配置 */
export const DEFAULT_WEIGHTS = {
  trick: 3.0,
  narrative: 1.6,
  // 推理流派：高于场景与题材，低于诡计与叙事。
  // 定位是"在诡计类型相近时进一步区分写法取向"，不喧宾夺主。
  school: 1.4,
  scene: 1.0,
  motive: 1.0,
  theme: 0.5,
};

export const DEFAULT_CONFIG = {
  limit: 3,
  weights: DEFAULT_WEIGHTS,
  /** trick / jaccard / rarity 三项融合比例 */
  blend: { overlap: 0.62, jaccard: 0.24, rarity: 0.14 },
  /** 无诡计标签重合时的最高得分系数（0.62 表示最多只能拿到 62% 的融合分） */
  noTrickCap: 0.62,
  /** 是否允许推荐用户自建条目 */
  includeUserBooks: false,
  /** 是否允许推荐被标记为禁推的作品 */
  includeBlocked: false,
  /** 同一作者最多推荐几本 */
  maxPerAuthor: 2,
  /**
   * 是否强制要求候选与目标在「诡计类」至少共享一个标签。
   * 需求文档的推荐逻辑要求"确保推荐作品在诡计机制层面高度相似"，
   * 因此默认开启；知识库过小时可关闭以避免推荐为空。
   */
  requireTrickOverlap: true,
  /**
   * 目标作品**本身没有任何「诡计类」标签**时，是否自动放宽上面那条硬约束。
   *
   * 这不是放松标准，而是承认一个事实：目标作品没有诡计标签时，
   * "诡计机制高度相似"这个条件在数学上无解（交集必然为空），
   * 若仍强行要求，结果只能是"永远 0 条推荐"。
   * 知识库里有一批社会派、法医鉴识、刑侦、间谍类作品（如北欧冷案、
   * 《首席女法医》系列）本就以取证与调查流程取胜，不该因此被孤立。
   *
   * 放宽时：跳过诡计硬约束，同时取消 noTrickCap 压制（否则所有候选的
   * 绝对相似度会被统一压低 38%，百分比失真），并在返回值里带
   * `trickGate.relaxed = true` 与说明，由界面**明确告知**读者
   * "本次推荐不含诡计维度"，绝不假装做过诡计比对。
   */
  relaxTrickOverlapWhenUntagged: true,
  /**
   * 背景标签阈值：出现频率高于此比例的标签（如全库 90% 的书都有的"本格解谜"）
   * 在加权杰卡德中被视为背景噪声而剔除，否则它们会把所有作品都拉得很像。
   */
  backgroundTagRatio: 0.7,
  /** 输出候选数量上限（用于"更多推荐"折叠区） */
  candidatePool: 12,
  /** 与目标作品同一系列的作品是否排除（避免"推荐同一本书的续作"） */
  excludeSameSeries: true,
};

/** 提取一本书的全部标签 id */
export function bookTagIds(book) {
  const ids = new Set();
  for (const key of ['tags', 'schoolTags', 'trickTags', 'narrativeTags', 'sceneTags', 'motiveTags', 'themeTags']) {
    for (const t of book?.[key] ?? []) ids.add(t);
  }
  return [...ids];
}

/**
 * 构建标签 -> 文档频率（IDF 用）。
 * @param {Array<object>} books
 */
export function buildIdf(books) {
  const df = new Map();
  let n = 0;
  for (const book of books ?? []) {
    const ids = bookTagIds(book);
    if (!ids.length) continue;
    n += 1;
    for (const id of ids) df.set(id, (df.get(id) ?? 0) + 1);
  }
  const idf = new Map();
  for (const [id, count] of df) {
    idf.set(id, Math.log((n + 1) / (count + 0.5)) + 1);
  }
  return { idf, total: n, df };
}

/**
 * 计算在语料中过于普遍的「背景标签」。
 * 这类标签（例如 90% 的书都被标了"本格解谜"）几乎不携带区分信息，
 * 如果参与杰卡德相似度，会把所有作品都拉得一样像，反而掩盖了真正的诡计差异。
 * 它们仍然参与加权重合度计算（权重本就低），只是不再污染整体画像的相似度。
 *
 * @param {Array<object>} books
 * @param {number} ratio 阈值，出现频率高于该比例即视为背景标签
 * @returns {Set<string>}
 */
export function findBackgroundTags(books, ratio = DEFAULT_CONFIG.backgroundTagRatio) {
  const total = (books ?? []).filter((b) => bookTagIds(b).length).length;
  if (total < 8) return new Set(); // 语料太小时不做剔除，避免误伤
  const df = new Map();
  for (const book of books ?? []) {
    for (const id of bookTagIds(book)) df.set(id, (df.get(id) ?? 0) + 1);
  }
  const background = new Set();
  for (const [id, count] of df) {
    if (count / total > ratio) background.add(id);
  }
  return background;
}

/** 类别权重（可被 config 覆盖） */
function weightOf(tagId, weights) {
  const category = tagCategory(tagId) ?? 'theme';
  return weights?.[category] ?? CATEGORY_WEIGHT[category] ?? 0.5;
}

/**
 * 计算一本书在其标签配置下的理论最高得分。
 *
 * 用来把原始得分归一化成**绝对**百分比。
 * 若不这样做，而是"以候选中最高分 = 100%"来归一化，会出现多本书并列 100%
 * 的假象（例如两本都在诡计类完全重合），读者会误以为系统认为它们同样相似。
 *
 * @param {string[]} tagIds
 * @param {{ weights?: object, background?: Set<string> | null, idf?: Map<string, number> | null }} [options]
 */
export function theoreticalMaxScore(tagIds, options = {}) {
  const { background = null, idf = null } = options;
  const ids = [...new Set(tagIds ?? [])].filter((id) => !(background?.has(id) === true));
  if (!ids.length) return 0;

  const blend = DEFAULT_CONFIG.blend;

  // 加权重合度上限为 1（全部标签共享）
  // 加权杰卡德上限为 1（两书标签集合完全相同）
  let max = blend.overlap + blend.jaccard;

  // 稀有度分量只有在该分量真正参与打分时（即提供了 idf）才计入上限。
  // 早期版本无条件计入，导致没有 idf 时理论上限被高估、百分比被系统性压低。
  if (idf && ids.some((id) => idf.has(id))) max += blend.rarity;

  return max;
}

/**
 * 把原始得分转换为 0~100 的**绝对**相似度。
 * @param {number} score
 * @param {string[]} targetTagIds
 * @param {{ weights?: object, background?: Set<string> | null, idf?: Map<string, number> | null }} [options]
 */
export function toPercent(score, targetTagIds, options = {}) {
  const max = theoreticalMaxScore(targetTagIds, options);
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((score / max) * 100)));
}

/**
 * 计算两个标签集合之间的相似度明细。
 * @param {string[]} targetIds
 * @param {string[]} candidateIds
 * @param {{ weights?: object, idf?: Map<string, number>, noTrickCap?: number, background?: Set<string> }} [options]
 */
export function scorePair(targetIds, candidateIds, options = {}) {
  const { weights = DEFAULT_WEIGHTS, idf, noTrickCap = DEFAULT_CONFIG.noTrickCap, background = null } = options;
  const target = new Set(targetIds ?? []);
  const candidate = new Set(candidateIds ?? []);

  const matched = [];
  const missing = [];
  const extra = [];
  let overlapScore = 0;
  let targetWeightTotal = 0;

  for (const id of target) {
    const w = weightOf(id, weights);
    targetWeightTotal += w;
    if (candidate.has(id)) {
      overlapScore += w;
      matched.push(id);
    } else {
      missing.push(id);
    }
  }
  for (const id of candidate) if (!target.has(id)) extra.push(id);

  // 加权重合度：共享权重 / 目标权重总量
  const weightedOverlap = targetWeightTotal > 0 ? overlapScore / targetWeightTotal : 0;

  // 加权杰卡德相似度：剔除背景标签，否则全库通用标签会淹没真实差异
  const isBackground = (id) => background?.has(id) === true;
  const unionWeight = new Set([...target, ...candidate]);
  let unionTotal = 0;
  let interTotal = 0;
  let informative = 0;
  for (const id of unionWeight) {
    if (isBackground(id)) continue;
    const w = weightOf(id, weights);
    unionTotal += w;
    informative += 1;
    if (target.has(id) && candidate.has(id)) interTotal += w;
  }
  const jaccard = unionTotal > 0 ? interTotal / unionTotal : 0;

  // 稀有度加权：共享标签的 IDF 均值（归一化到 0~1）
  let rarity = 0;
  if (idf && matched.length) {
    const raw = matched.reduce((sum, id) => sum + (idf.get(id) ?? 1), 0) / matched.length;
    rarity = Math.max(0, Math.min(1, (raw - 0.4) / 1.6));
  }

  // 类别明细
  const byCategory = {};
  for (const cid of CATEGORY_ORDER) {
    const t = [...target].filter((id) => tagCategory(id) === cid);
    const m = matched.filter((id) => tagCategory(id) === cid);
    byCategory[cid] = {
      category: cid,
      label: CATEGORY_MAP[cid]?.label ?? cid,
      weight: weightOf(t[0] ?? cid, weights),
      matched: m,
      missing: t.filter((id) => !m.includes(id)),
      matchedCount: m.length,
      targetCount: t.length,
      ratio: t.length ? m.length / t.length : null,
    };
  }

  const trickMatched = matched.filter((id) => tagCategory(id) === 'trick');
  const narrativeMatched = matched.filter((id) => tagCategory(id) === 'narrative');
  const sceneMatched = matched.filter((id) => tagCategory(id) === 'scene');
  const motiveMatched = matched.filter((id) => tagCategory(id) === 'motive');
  const themeMatched = matched.filter((id) => tagCategory(id) === 'theme');
  const schoolMatched = matched.filter((id) => tagCategory(id) === 'school');

  const blend = DEFAULT_CONFIG.blend;
  let score = blend.overlap * weightedOverlap + blend.jaccard * jaccard + blend.rarity * rarity;

  // 领域约束：诡计机制层面无重合时压制得分
  if (trickMatched.length === 0) score *= noTrickCap;

  return {
    rawScore: score,
    weightedOverlap,
    jaccard,
    rarity,
    informativeTagCount: informative,
    matched,
    missing,
    extra,
    byCategory,
    trickMatched,
    narrativeMatched,
    sceneMatched,
    motiveMatched,
    themeMatched,
    schoolMatched,
    overlapScore,
    targetWeightTotal,
  };
}

/**
 * 生成匹配理由（仅比较诡计类型与风格，绝不涉及谜底）。
 * 理由文本由共享标签拼装，因此天然满足"所说即所共享"。
 */
export function buildReason(target, candidate, detail) {
  const label = (ids) => ids.slice(0, 3).map(tagLabel);

  if (candidate.recommendationReason) {
    return candidate.recommendationReason;
  }

  const trick = label(detail.trickMatched);
  const narrative = label(detail.narrativeMatched);
  const scene = label(detail.sceneMatched);
  const motive = label(detail.motiveMatched);
  const school = label(detail.schoolMatched);

  const parts = [];
  if (trick.length) parts.push(`核心诡计同属 ${trick.map((t) => `\`${t}\``).join(' ')} 机制`);
  if (school.length) parts.push(`同属 ${school.map((t) => `\`${t}\``).join(' ')} 写法`);
  if (narrative.length) parts.push(`叙事上同样采用 ${narrative.map((t) => `\`${t}\``).join(' ')}`);
  if (scene.length) parts.push(`舞台设定相近（${scene.map((t) => `\`${t}\``).join(' ')}）`);
  if (motive.length && parts.length === 0) parts.push(`动机类型同样落在 ${motive.map((t) => `\`${t}\``).join(' ')}`);

  if (!parts.length) {
    const fallback = label(detail.matched);
    if (fallback.length) parts.push(`整体标签画像相近（${fallback.map((t) => `\`${t}\``).join(' ')}）`);
  }

  let reason = parts.join('，');
  // 同作者判断必须走署名人列表的交集：合著作品与其中任一作者的独著之间也算同作者
  const sameAuthor = sharedAuthor(candidate, target);
  if (sameAuthor) {
    reason += `；同为本格脉络下的 ${sameAuthor} 作品`;
  }
  if (!reason) reason = '标签画像相近，可作为同类型阅读延伸。';
  return `${reason}。`;
}

/**
 * 生成推荐。
 * @param {object} target 目标书籍
 * @param {Array<object>} corpus 知识库（含目标书自身即可，会自动排除）
 * @param {object} [config]
 */
export function recommend(target, corpus, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const targetIds = bookTagIds(target);
  const { idf } = buildIdf(corpus);
  const background = findBackgroundTags(corpus, cfg.backgroundTagRatio);

  // 目标作品自己有没有「诡计类」标签，决定了"诡计机制高度相似"这条要求能不能被检验。
  const targetTrickIds = targetIds.filter((id) => tagCategory(id) === 'trick');
  const untagged = targetTrickIds.length === 0;
  const relaxed = untagged && cfg.relaxTrickOverlapWhenUntagged === true;
  const trickGateApplied = cfg.requireTrickOverlap && !relaxed;
  // 目标没有诡计标签时，noTrickCap 会对**所有**候选统一下压，只是把百分比整体缩小，
  // 既不改变排序也失真，因此一并取消。
  const effectiveNoTrickCap = relaxed ? 1 : cfg.noTrickCap;

  const excluded = [];
  const scored = [];

  for (const candidate of corpus ?? []) {
    if (!candidate || candidate.id === target?.id) continue;
    if (!cfg.includeUserBooks && candidate.origin === 'user') {
      excluded.push({ book: candidate, reason: '用户自建条目，默认不参与推荐' });
      continue;
    }
    if (!cfg.includeBlocked && candidate.recommendable === false) {
      excluded.push({ book: candidate, reason: '已标记为不参与推荐' });
      continue;
    }
    if (cfg.excludeSameSeries && sameSeries(target, candidate)) {
      excluded.push({ book: candidate, reason: '与目标作品同属一个系列' });
      continue;
    }

    const ids = bookTagIds(candidate);
    const detail = scorePair(targetIds, ids, {
      weights: cfg.weights,
      idf,
      noTrickCap: effectiveNoTrickCap,
      background,
    });

    // 需求文档要求"确保推荐作品在诡计机制层面高度相似"：
    // 诡计类零重合的候选默认不予推荐，而不是勉强凑数。
    // 例外：目标作品自身没有诡计标签时该要求无解，此时放宽（并如实标注）。
    if (trickGateApplied && detail.trickMatched.length === 0) {
      excluded.push({
        book: candidate,
        reason: `与目标作品没有共享任何「诡计类」标签（重合度 ${(detail.weightedOverlap * 100).toFixed(0)}%），不满足"诡计机制高度相似"的要求`,
      });
      continue;
    }

    // 领域加成（同作者按**署名作者列表的交集**判断，合著作品同样享受加成）
    let bonus = 0;
    if (sharedAuthor(target, candidate)) bonus += 0.05;
    if (target.genre && candidate.genre === target.genre) bonus += 0.02;
    if (candidate.verification?.verified) bonus += 0.01;

    const detailWithScore = { ...detail, bonus };

    const reason = buildReason(target, candidate, detail);
    const check = analyzeRecommendation({ reason, tags: detail.matched, book: candidate, target });

    // 依赖保险库的候选直接剔除（防御性：保险库内容永不出现在输出中）
    const containsVaultLeak = check.findings.some((f) => f.category === '跨作品泄底' && f.risk === RISK.HIGH);

    scored.push({
      book: candidate,
      id: candidate.id,
      score: detail.rawScore + bonus,
      percent: 0, // 稍后统一归一化
      detail: detailWithScore,
      reason,
      safety: check,
      safe: check.passed && !containsVaultLeak,
    });
  }

  scored.sort((a, b) => b.score - a.score || String(a.book.title).localeCompare(String(b.book.title), 'zh'));

  // 归一化为**绝对**相似度：以"与该书标签配置完全相同"为理论上限，
  // 而不是以候选中最高分作为 100%——后者会让多本书并列 100%，造成误导。
  const normalization = { weights: cfg.weights, background, idf };
  for (const item of scored) {
    item.percent = toPercent(item.score, targetIds, normalization);
    item.confidence = confidenceOf(item.detail, item.percent);
  }

  // 作者多样性约束。
  // 按**署名作者列表**计数：一本合著作品要同时占用每位合著者的名额，
  // 否则「舍瓦尔、瓦勒」被当成一个独立作者，两人的名额就都形同虚设。
  const authorCount = new Map();
  const picked = [];
  const overflow = [];
  for (const item of scored) {
    if (!item.safe) {
      overflow.push({ ...item, dropped: '安全校验未通过：匹配理由存在泄底风险' });
      continue;
    }
    const names = authorListOf(item.book);
    const capped = names.find((name) => (authorCount.get(name) ?? 0) >= cfg.maxPerAuthor);
    if (capped) {
      overflow.push({ ...item, dropped: `同一作者最多推荐 ${cfg.maxPerAuthor} 本` });
      continue;
    }
    for (const name of names) authorCount.set(name, (authorCount.get(name) ?? 0) + 1);
    picked.push(item);
    if (picked.length >= cfg.limit) break;
  }

  const candidates = [...picked, ...overflow].slice(0, cfg.candidatePool);

  return {
    target: { id: target?.id, title: target?.title, tags: targetIds },
    recommendations: picked,
    candidates,
    excluded,
    backgroundTags: [...background],
    idfSize: idf.size,
    generatedAt: new Date().toISOString(),
    trickGate: {
      required: cfg.requireTrickOverlap === true,
      applied: trickGateApplied,
      relaxed,
      targetTrickCount: targetTrickIds.length,
      note: relaxed
        ? '本书未标注任何「诡计类」标签，无法进行诡计机制比对；以下推荐仅依据推理流派、叙事方式、场景、动机与题材的相似度，不代表诡计类型相同。'
        : trickGateApplied
          ? '已强制要求候选与本书至少共享一个「诡计类」标签。'
          : '本次未启用「诡计类」重合硬约束（由调用方配置关闭）。',
    },
    config: cfg,
  };
}

/** 判断是否为同一系列（复用 seed.js 的归一化实现，避免两套规则不一致） */
function sameSeries(a, b) {
  return sameSeriesShared(a?.series, b?.series);
}

/**
 * 置信度分档。
 *
 * 阈值按**绝对**相似度标定（同书标签配置完全相同 = 100%）。
 * 实测参考：《无人生还》×《狱门岛》89%、《嫌疑人X的献身》×《白夜行》80%、
 * 仅场景/题材相近的书通常在 40% 以下。因此 75% 以上才算"高度相似"。
 */
function confidenceOf(detail, percent = 0) {
  const trick = detail.trickMatched.length;
  const total = detail.matched.length;

  if (percent >= 75 && trick >= 2) return { level: 'high', label: '高度相似' };
  if (percent >= 58 && trick >= 1) return { level: 'medium', label: '较为相似' };
  if (percent >= 40 && total >= 2) return { level: 'low', label: '风格相近' };
  return { level: 'weak', label: '参考推荐' };
}

/**
 * 按共享标签反查"最相似的 N 本"，用于知识库页的"找相似"。
 */
export function similarById(bookId, corpus, config = {}) {
  const target = corpus.find((b) => b.id === bookId);
  if (!target) return null;
  return recommend(target, corpus, config);
}

/** 相关性矩阵：返回每个标签下最热门的书目（用于标签体系页） */
export function tagCooccurrence(books) {
  const map = new Map();
  for (const book of books ?? []) {
    const ids = bookTagIds(book);
    for (const id of ids) {
      if (!map.has(id)) map.set(id, { tag: id, label: tagLabel(id), category: tagCategory(id), books: [] });
      map.get(id).books.push(book.id);
    }
  }
  return [...map.values()].sort((a, b) => b.books.length - a.books.length);
}
