#!/usr/bin/env node
/**
 * 核心逻辑单元测试（零依赖，使用 node:test）
 * 运行：node --test scripts/test-core.mjs   或   npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { TAGS, TAG_MAP, normalizeTag, tagCategory, tagLabel, tagLabels, partitionTags } from '../web/js/core/tags.js';
import { CATEGORY_MAP, TAG_CATEGORIES } from '../web/js/core/tags.js';
import {
  RISK,
  analyzeBook,
  analyzeRecommendation,
  countChars,
  runSelfCheck,
  scanText,
  stripVault,
} from '../web/js/core/safety.js';
import {
  DEFAULT_CONFIG,
  bookTagIds,
  buildIdf,
  findBackgroundTags,
  recommend,
  scorePair,
  theoreticalMaxScore,
  toPercent,
} from '../web/js/core/engine.js';
import { markdownToHtml, renderReport, renderRecommendations } from '../web/js/core/report.js';
import { tags as renderTagList } from '../web/js/core/markdown.js';
import { suggestTags } from '../web/js/core/suggest.js';
import { normalizeSeedBook, splitSchoolTags, splitAuthors, authorListOf, sharedAuthor, collabLabel } from '../web/js/core/seed.js';
import { GENRE_OPTIONS, canonicalGenre } from '../web/js/core/seed.js';
import { canonicalSeries, sameSeries } from '../web/js/core/seed.js';
import { duplicateReason, looksLikeCollectionName, normText } from './lib/dup-rules.mjs';
import { compareFingerprints, dhashDistance, dhashFromGray, isSameCover, meanAbsDiff } from './lib/image-fp.mjs';
import {
  COVER_MATCH_CODE,
  coverCodeOf,
  imageSize,
  isTraditionalTitle,
  orderEditionsForPrimary,
  preferLargerImage,
  sameTitleEdition,
  isBlockPage,
  isDefaultPic,
  isbnsOf,
  parseInfoLite,
  parseMainPic,
  parseWereadSearch,
  parseWorksEditions,
  parseWorksLink,
  pickNewestEdition,
  pickWereadEditions,
  titleQueries,
  toIsbn13,
  wereadCoverAt,
  yearOf,
} from './lib/covers.mjs';
import {
  PLATFORM_RULES,
  parseCount,
  parseDoubanOtherEditions,
  parseDoubanSubject,
  parseDoubanSuggest,
  parseWereadBook,
  stripTags,
  validateBatch,
  validateRating,
} from '../web/js/core/ratings.js';
import { buildQueries, cjkToNumber, looksLikeDifferentBook, normalizeAuthor, normalizeTitle, shortAuthorName, toTraditional } from './refresh-ratings.mjs';
import { esc, html, raw } from '../web/js/ui/dom.js';
import { listStateKey, scrollKey, shouldRestoreScroll } from '../web/js/core/scroll-memory.js';
import { authorStats, countryStats, filterAuthors, regionOf } from '../web/js/core/catalog.js';
import { versionAssets, versionModuleImports } from '../server/lib/static.mjs';

/* ------------------------------------------------------------------ */
/* 标签字典                                                            */
/* ------------------------------------------------------------------ */

test('标签字典：id 唯一、类别合法、必需的核心标签齐备', () => {
  const ids = TAGS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, '标签 id 出现重复');

  // ⚠️ 本白名单必须与 TAG_CATEGORIES 保持同步：新增类别时这里要一起改，
  // 否则会以"类别非法"的形式失败（新增 school 类别时踩过一次）。
  // 更好的做法是直接从 TAG_CATEGORIES 派生，见下方断言。
  const validCategories = new Set(TAG_CATEGORIES.map((c) => c.id));
  assert.deepEqual(
    [...validCategories].sort(),
    ['motive', 'narrative', 'scene', 'school', 'theme', 'trick'],
    '类别集合发生变化时请同步更新本断言',
  );
  for (const tag of TAGS) {
    assert.ok(validCategories.has(tag.category), `${tag.id} 的类别非法：${tag.category}`);
    assert.ok(tag.label && tag.label.length > 0, `${tag.id} 缺少中文标签名`);
    assert.ok(tag.desc && tag.desc.length >= 10, `${tag.id} 缺少释义或释义过短`);
  }

  // 需求文档明确列出的 14 个核心诡计标签必须全部存在
  const required = ['密室', '不在场证明', '叙述性诡计', '时刻表诡计', '无面尸', '凶器消失', '暴风雪山庄', '多重解答', '心理误导', '红鲱鱼', '交换杀人', '童谣杀人', '暗号密码', '一人二角'];
  const labels = new Set(TAGS.map((t) => t.label));
  for (const label of required) assert.ok(labels.has(label), `缺少需求文档要求的核心诡计标签：${label}`);
});

test('normalizeTag：支持 id、中文标签与别名，未知输入返回 null', () => {
  assert.equal(normalizeTag('locked-room'), 'locked-room');
  assert.equal(normalizeTag('密室'), 'locked-room');
  assert.equal(normalizeTag('密室杀人'), 'locked-room');
  assert.equal(normalizeTag('叙述诡计'), 'narrative-trick');
  assert.equal(normalizeTag('不会存在的标签'), null);
  assert.equal(normalizeTag(''), null);
  assert.equal(normalizeTag(undefined), null);
});

test('partitionTags：区分合法与未知标签', () => {
  const { valid, unknown } = partitionTags(['locked-room', 'bogus-tag', 'alibi']);
  assert.deepEqual(valid, ['locked-room', 'alibi']);
  assert.deepEqual(unknown, ['bogus-tag']);
});

/* ------------------------------------------------------------------ */
/* 反剧透引擎                                                          */
/* ------------------------------------------------------------------ */

test('countChars：中文按字符计、不把代理对算成两个', () => {
  assert.equal(countChars('密室杀人'), 4);
  assert.equal(countChars(''), 0);
  assert.equal(countChars('🔍密室'), 3);
  assert.equal(countChars(null), 0);
});

test('scanText：命中凶手身份断言，判定为高危', () => {
  const result = scanText('这本书的凶手是管家，动机是遗产。');
  assert.equal(result.passed, false);
  assert.equal(result.highestRisk, RISK.HIGH);
  assert.ok(result.findings.some((f) => f.category === '凶手身份'));
});

test('scanText：命中手法与破解描述', () => {
  const cases = [
    '凶手利用暗道完成了密室。',
    '破解的关键在于死亡时间被伪造。',
    '真相是所有人都在撒谎。',
    '最终真凶浮出水面。',
    '诡计的核心就在于双重身份。',
  ];
  for (const text of cases) {
    const result = scanText(text);
    assert.equal(result.passed, false, `应当命中剧透：${text}`);
  }
});

test('scanText：白名单表述不应误报', () => {
  const safe = [
    '本书请读者自行找出凶手是谁。',
    '全程不剧透，可放心阅读。',
    '凶手身份不明，直到最后才有线索。',
    '这是一部无剧透的阅读指南。',
  ];
  for (const text of safe) {
    const result = scanText(text);
    assert.equal(result.passed, true, `误报：${text} → ${JSON.stringify(result.findings.map((f) => f.match))}`);
  }
});

test('scanText：正常的类型级描述必须放行（这是系统的主要文案形态）', () => {
  const safe = [
    '核心诡计同属 `密室` `暴风雪山庄` 机制，叙事上同样采用 `群像`。',
    '本书存在叙述性诡计，请留意叙述者本身。',
    '受故友之托前往一座孤立小岛，等待他的却是旧宅中接连发生的异样死亡。',
    '读者普遍认为其封闭孤岛舞台与连续死亡的节奏感极具代表性。',
    '建议留意人物之间的亲缘关系与家族谱系。',
    '动机仅标注类型，不说明具体指向何人。',
  ];
  for (const text of safe) {
    const result = scanText(text);
    assert.equal(result.passed, true, `误报：${text} → ${JSON.stringify(result.findings)}`);
  }
});

test('scanText：空文本直接通过', () => {
  assert.equal(scanText('').passed, true);
  assert.equal(scanText(null).passed, true);
});

test('analyzeBook：超长简介在严格长度字段上被标记', () => {
  const book = {
    id: 'test-1',
    title: '测试作品',
    author: '测试作者',
    safeSummary: '测'.repeat(120),
    tags: ['locked-room'],
  };
  const report = analyzeBook(book);
  assert.equal(report.passed, false);
  assert.ok(report.issues.some((i) => i.ruleId === 'length' && i.field === 'safeSummary'));
});

test('analyzeBook：干净数据通过体检', () => {
  const book = {
    id: 'test-2',
    title: '测试作品',
    author: '测试作者',
    safeSummary: '一名编辑收到作家新稿，却发现最后一章不翼而飞。',
    tags: ['locked-room', 'meta-fiction'],
    readingTips: { suitableFor: [], watchFor: [], warning: '' },
    ratings: {},
  };
  const report = analyzeBook(book);
  assert.equal(report.passed, true, JSON.stringify(report.issues));
});

test('analyzeBook：includeVault 时报告保险库状态但不泄露内容', () => {
  const book = { id: 'x', title: 't', vault: { culprit: '某人', coreTrick: '某手法', ending: '', notes: '' } };
  const report = analyzeBook(book, { includeVault: true });
  const vaultResult = report.results.find((r) => r.field === 'vault');
  assert.ok(vaultResult, '应包含保险库条目');
  assert.equal(vaultResult.filledFields.length, 2);
  // 报告里不能出现保险库的具体内容
  assert.ok(!JSON.stringify(report).includes('某人'));
  assert.ok(!JSON.stringify(report).includes('某手法'));
});

test('stripVault：递归剥离所有 vault 字段', () => {
  const input = {
    title: 'a',
    vault: { culprit: 'X' },
    nested: { list: [{ vault: { culprit: 'Y' }, keep: 1 }] },
  };
  const out = stripVault(input);
  assert.equal(out.vault, undefined);
  assert.equal(out.nested.list[0].vault, undefined);
  assert.equal(out.nested.list[0].keep, 1);
  assert.ok(!JSON.stringify(out).includes('X'));
  assert.ok(!JSON.stringify(out).includes('Y'));
});

test('analyzeRecommendation：引用未共享的标签会被标记', () => {
  const target = { id: 't', tags: ['locked-room', 'mansion'] };
  const candidate = { id: 'c', tags: ['alibi', 'city'] };
  // 理由里宣称共享了「密室」，但候选书实际没有该标签
  const result = analyzeRecommendation({ reason: '两书同为密室杰作。', tags: ['locked-room'], book: candidate, target });
  const mismatch = result.findings.find((f) => f.ruleId === 'tag-mismatch');
  assert.ok(mismatch, '应检出「引用了未共享标签」');
  assert.equal(mismatch.risk, RISK.LOW);
  assert.ok(result.findings.some((f) => f.ruleId === 'no-shared-tag'));
});

test('analyzeRecommendation：无任何共享标签时提示匹配依据不足', () => {
  const target = { id: 't', tags: ['locked-room'] };
  const candidate = { id: 'c', tags: ['city'] };
  const result = analyzeRecommendation({ reason: '整体风格相近。', tags: [], book: candidate, target });
  assert.ok(result.findings.some((f) => f.ruleId === 'no-shared-tag'));
});

/* ------------------------------------------------------------------ */
/* 推荐引擎                                                            */
/* ------------------------------------------------------------------ */

/** 构造测试语料 */
function makeBook(id, tags, extra = {}) {
  return {
    id,
    title: `书${id}`,
    author: extra.author ?? `作者${id}`,
    genre: extra.genre ?? '本格推理',
    tags,
    safeSummary: '简介',
    ratings: {},
    origin: extra.origin ?? 'seed',
    ...extra,
  };
}

test('scorePair：诡计类重合的权重远高于场景类重合', () => {
  const target = makeBook('t', ['locked-room', 'mansion', 'first-person', 'city']);
  const { idf } = buildIdf([target]);

  const trickMatch = scorePair(target.tags, ['locked-room', 'alibi', 'train'], { idf });
  const sceneMatch = scorePair(target.tags, ['mansion', 'city', 'countryside'], { idf });

  assert.ok(
    trickMatch.rawScore > sceneMatch.rawScore,
    `诡计类重合得分(${trickMatch.rawScore.toFixed(3)})应高于场景类重合得分(${sceneMatch.rawScore.toFixed(3)})`,
  );
});

test('scorePair：无诡计类重合时得分被压制', () => {
  const target = makeBook('t', ['locked-room', 'mansion']);
  const { idf } = buildIdf([target]);
  const withTrick = scorePair(target.tags, ['locked-room', 'mansion'], { idf });
  const noTrick = scorePair(target.tags, ['mansion', 'city', 'countryside', 'campus'], { idf });
  assert.equal(noTrick.trickMatched.length, 0);
  assert.ok(noTrick.rawScore < withTrick.rawScore);
});

test('recommend：优先返回诡计机制更接近的作品', () => {
  const target = makeBook('target', ['locked-room', 'closed-circle', 'isolated-island', 'ensemble'], { title: '目标书' });
  const corpus = [
    target,
    makeBook('close', ['locked-room', 'closed-circle', 'isolated-island', 'mansion'], { title: '相似书' }),
    makeBook('far', ['cipher', 'city', 'hardboiled'], { title: '无关书' }),
    makeBook('mid', ['locked-room', 'city', 'first-person'], { title: '中等书' }),
  ];

  const result = recommend(target, corpus, { limit: 3 });
  assert.equal(result.recommendations[0].id, 'close');
  assert.ok(result.recommendations[0].percent >= result.recommendations[1].percent);
  assert.equal(result.recommendations[0].safety.passed, true);
});

test('recommend：排除目标作品自身、同系列作品与用户自建条目', () => {
  const target = makeBook('target', ['locked-room'], { title: '目标书', series: '某某系列' });
  const corpus = [
    target,
    makeBook('same-series', ['locked-room'], { series: '某某系列', title: '续作' }),
    makeBook('user-book', ['locked-room'], { origin: 'user', title: '用户自建' }),
    makeBook('ok', ['locked-room'], { title: '合格的候选' }),
  ];

  const result = recommend(target, corpus, { limit: 5 });
  const ids = result.recommendations.map((r) => r.id);
  assert.deepEqual(ids, ['ok']);
  assert.ok(result.excluded.some((e) => e.book.id === 'same-series'));
  assert.ok(result.excluded.some((e) => e.book.id === 'user-book'));
});

test('recommend：同一作者默认最多推荐 2 本', () => {
  const target = makeBook('target', ['locked-room'], { title: '目标书' });
  const corpus = [
    target,
    makeBook('a1', ['locked-room'], { author: '同一人', title: 'A1' }),
    makeBook('a2', ['locked-room'], { author: '同一人', title: 'A2' }),
    makeBook('a3', ['locked-room'], { author: '同一人', title: 'A3' }),
    makeBook('b1', ['alibi'], { author: '另一人', title: 'B1' }),
  ];
  const result = recommend(target, corpus, { limit: 3 });
  const sameAuthor = result.recommendations.filter((r) => r.book.author === '同一人');
  assert.ok(sameAuthor.length <= DEFAULT_CONFIG.maxPerAuthor, `同一作者推荐了 ${sameAuthor.length} 本`);
});

test('recommend：置信度分档与相似度口径一致，不再虚高', () => {
  const target = makeBook('target', ['locked-room', 'closed-circle', 'isolated-island', 'ensemble'], { title: '目标书' });
  const corpus = [
    target,
    // 诡计与场景几乎全同 → 应当高相似
    makeBook('near', ['locked-room', 'closed-circle', 'isolated-island', 'mansion'], { title: '很近' }),
    // 只有一个叙事标签重合 → 不该被判为高相似
    makeBook('far', ['ensemble', 'city', 'youth'], { title: '较远' }),
    makeBook('far2', ['red-herring', 'city'], { title: '更远' }),
  ];

  const result = recommend(target, corpus, { limit: 3, requireTrickOverlap: false });
  const near = result.recommendations.find((r) => r.id === 'near');
  const far = result.recommendations.find((r) => r.id === 'far');

  assert.ok(near.percent > 60, `诡计高度重合的候选相似度应偏高，实际 ${near.percent}%`);
  assert.ok(far.percent < 60, `仅叙事标签重合的候选不应超过 60%，实际 ${far.percent}%`);
  assert.ok(near.percent > far.percent, '排序应与相似度一致');

  // 不存在"共享很少却拿到 100%"的情况
  assert.ok(far.percent < 100);
  const allPercent = result.recommendations.map((r) => r.percent);
  assert.ok(Math.max(...allPercent) <= 100);
});

test('recommend：候选不足时返回空列表而不是报错', () => {
  const target = makeBook('only', ['locked-room']);
  const result = recommend(target, [target], { limit: 3 });
  assert.deepEqual(result.recommendations, []);
});

test('recommend：默认排除与目标无任何诡计类标签重合的候选', () => {
  const target = makeBook('target', ['locked-room'], { title: '目标书' });
  const corpus = [target, makeBook('no-trick', ['city', 'countryside'], { title: '无诡计重合' }), makeBook('ok', ['locked-room'], { title: '有重合' })];

  const strict = recommend(target, corpus, { limit: 3 });
  assert.deepEqual(strict.recommendations.map((r) => r.id), ['ok']);
  assert.ok(strict.excluded.some((e) => e.book.id === 'no-trick'));

  // 关闭约束后可推荐，但得分应被压制
  const loose = recommend(target, corpus, { limit: 3, requireTrickOverlap: false });
  assert.ok(loose.recommendations.length >= 1);
  const noTrick = loose.recommendations.find((r) => r.id === 'no-trick');
  if (noTrick) {
    const ok = loose.recommendations.find((r) => r.id === 'ok');
    assert.ok(noTrick.score < ok.score, '无诡计重合的候选得分应低于有重合的候选');
  }
});

test('recommend：目标作品没有诡计类标签时放宽硬约束，并如实标注', () => {
  // 社会派 / 法医鉴识 / 刑侦类作品往往本就没有「诡计类」标签，
  // 此时"诡计机制高度相似"在数学上无解，必须放宽而不是返回空列表。
  const target = makeBook('untagged', ['city', 'social-commentary'], { title: '无诡计标签的目标书' });
  const corpus = [
    target,
    makeBook('near', ['city', 'social-commentary', 'dark-atmosphere'], { title: '相近' }),
    makeBook('tricked', ['locked-room', 'mansion'], { title: '有诡计标签' }),
  ];

  const result = recommend(target, corpus, { limit: 3 });

  assert.ok(result.recommendations.length > 0, '无诡计标签的目标书也应能拿到推荐，而不是空列表');
  assert.equal(result.trickGate.relaxed, true, 'trickGate.relaxed 应为 true');
  assert.equal(result.trickGate.applied, false, '放宽后不应再施加诡计硬约束');
  assert.equal(result.trickGate.targetTrickCount, 0);
  assert.match(result.trickGate.note, /诡计/, 'note 必须说明本次推荐不含诡计比对');
  // 相近（共享城市 + 社会议题）应排在前面
  assert.equal(result.recommendations[0].id, 'near');
});

test('recommend：目标作品有诡计类标签时仍然强制要求诡计重合（放宽只针对无标签的书）', () => {
  const target = makeBook('tagged', ['locked-room', 'city'], { title: '有诡计标签' });
  const corpus = [
    target,
    makeBook('no-trick', ['city', 'social-commentary'], { title: '只有场景重合' }),
    makeBook('ok', ['locked-room', 'mansion'], { title: '诡计重合' }),
  ];

  const result = recommend(target, corpus, { limit: 3 });
  assert.deepEqual(result.recommendations.map((r) => r.id), ['ok']);
  assert.equal(result.trickGate.relaxed, false);
  assert.equal(result.trickGate.applied, true);
  assert.ok(result.excluded.some((e) => e.book.id === 'no-trick'));
});

test('recommend：放宽时不再用 noTrickCap 压低百分比，且可用配置关闭放宽', () => {
  const target = makeBook('untagged', ['city', 'social-commentary'], { title: '无诡计标签的目标书' });
  // 两本候选与目标标签完全相同 → 绝对相似度应接近 100%，不该被 noTrickCap 压到 ~62%
  const twin = makeBook('twin', ['city', 'social-commentary'], { title: '同标签' });
  const relaxed = recommend(target, [target, twin], { limit: 1 });
  assert.ok(
    relaxed.recommendations[0].percent >= 90,
    `标签完全相同的候选绝对相似度应接近 100%，实际 ${relaxed.recommendations[0].percent}%`,
  );

  // 关闭放宽 → 回到"零诡计重合直接剔除"的严格行为
  const strict = recommend(target, [target, twin], { limit: 1, relaxTrickOverlapWhenUntagged: false });
  assert.deepEqual(strict.recommendations, []);
  assert.equal(strict.trickGate.relaxed, false);
  assert.equal(strict.trickGate.applied, true);
});

test('findBackgroundTags：识别全库通用的标签，语料过小时不剔除', () => {
  // 12 本书里 11 本都带 honkaku → 视为背景标签
  const books = Array.from({ length: 12 }, (_, i) =>
    makeBook(`b${i}`, i < 11 ? ['honkaku', 'locked-room'] : ['alibi']),
  );
  const background = findBackgroundTags(books, 0.7);
  assert.ok(background.has('honkaku'), 'honkaku 出现 11/12，应被判为背景标签');
  // locked-room 出现在 11/12 中，同样超过阈值；alibi 只出现 1 次，不应被判为背景
  assert.ok(!background.has('alibi'), 'alibi 只出现 1 次，不应被判为背景标签');

  // 语料不足 8 本时不剔除，避免误伤
  const tiny = [makeBook('a', ['honkaku']), makeBook('b', ['honkaku'])];
  assert.equal(findBackgroundTags(tiny, 0.7).size, 0);
});

test('scorePair：背景标签不参与加权杰卡德计算', () => {
  const target = ['locked-room', 'honkaku'];
  const candidate = ['alibi', 'honkaku'];
  const noBackground = scorePair(target, candidate, {});
  const withBackground = scorePair(target, candidate, { background: new Set(['honkaku']) });
  // 剔除背景标签后，两者在杰卡德维度上完全不像
  assert.equal(withBackground.jaccard, 0);
  assert.ok(noBackground.jaccard > 0);
});

test('recommend：匹配理由只引用两书真实共享的标签', () => {
  const target = makeBook('target', ['locked-room', 'closed-circle'], { title: '目标书' });
  const corpus = [target, makeBook('cand', ['locked-room', 'city'], { title: '候选书' })];
  const result = recommend(target, corpus, { limit: 1 });
  const rec = result.recommendations[0];
  assert.ok(rec.reason.includes('密室'), `理由应提到共享的「密室」：${rec.reason}`);
  assert.ok(!rec.reason.includes('暴风雪山庄'), '理由不应提到未共享的标签');
  assert.equal(rec.safety.passed, true);
});

test('bookTagIds：合并全部标签字段并去重', () => {
  const book = { tags: ['a'], trickTags: ['a', 'b'], sceneTags: ['c'], motiveTags: [], narrativeTags: ['d'] };
  assert.deepEqual(bookTagIds(book).sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(bookTagIds({}), []);
});

test('toPercent：绝对归一化，不会出现多本并列 100%', () => {
  const target = ['locked-room', 'mansion', 'first-person', 'city'];

  // 标签集合完全相同的候选项才是 100%
  const identical = scorePair(target, [...target], {});
  assert.equal(toPercent(identical.rawScore, target), 100);

  // 只共享一部分的书必须明显低于 100%
  const partial = scorePair(target, ['locked-room', 'city'], {});
  const partialPercent = toPercent(partial.rawScore, target);
  assert.ok(partialPercent > 0 && partialPercent < 85, `部分重合应明显低于 100%，实际 ${partialPercent}`);

  // 另一本也完全相同的书 —— 两本都是 100% 是可以接受的（它们确实一样），
  // 但"共享一半"的书绝不会被抬到 100%
  const another = scorePair(target, [...target], {});
  assert.equal(toPercent(another.rawScore, target), 100);
});

test('toPercent：目标作品没有标签时返回 0 而不是报错', () => {
  assert.equal(toPercent(0.5, []), 0);
  assert.equal(theoreticalMaxScore([]), 0);
});

test('toPercent：背景标签不参与理论上限计算', () => {
  const background = new Set(['honkaku']);
  // 目标只有背景标签 → 没有可比信息，输出 0
  assert.equal(toPercent(0.2, ['honkaku'], { background }), 0);
  // 目标有真实标签时正常计算
  assert.ok(toPercent(0.5, ['locked-room', 'honkaku'], { background }) > 0);
});

/* ------------------------------------------------------------------ */
/* 安全自检                                                            */
/* ------------------------------------------------------------------ */

test('runSelfCheck：干净数据 5 项全通过', () => {
  const book = makeBook('t', ['locked-room'], { title: '干净的书', safeSummary: '一部关于密室的作品。' });
  const recs = [{ book: makeBook('r', ['locked-room'], { title: '推荐书' }), reason: '核心诡计同属 `密室` 机制。', detail: { matched: ['locked-room'] } }];
  const result = runSelfCheck({ book, recommendations: recs });
  assert.equal(result.passed, true, JSON.stringify(result.blockers));
  assert.equal(result.items.length, 5);
  assert.ok(result.items.every((i) => i.passed));
});

test('runSelfCheck：书籍内含剧透时自检不通过并给出 blocker', () => {
  const book = makeBook('t', ['locked-room'], { title: '有问题的书', safeSummary: '凶手是管家，真相是他一直在说谎。' });
  const result = runSelfCheck({ book, recommendations: [] });
  assert.equal(result.passed, false);
  assert.ok(result.blockers.length > 0);
  assert.ok(result.items.some((i) => !i.passed));
});

/* ------------------------------------------------------------------ */
/* 报告渲染                                                            */
/* ------------------------------------------------------------------ */

test('renderReport：包含需求文档要求的全部六个章节', () => {
  const book = makeBook('t', ['locked-room', 'mansion', 'first-person', 'revenge'], {
    title: '结构测试',
    author: '作者',
    genre: '本格推理',
    firstPublished: '1939',
    safeSummary: '十个人来到孤岛。',
  });
  const md = renderReport({ book, recommendations: [] });

  for (const heading of [
    '一、小说基础信息',
    '二、诡计标签',
    '2.1 核心诡计标签',
    '2.2 叙事标签',
    '2.3 场景标签',
    '2.4 动机标签',
    '三、无剧透简介',
    '四、相似作品推荐',
    '五、平台评价参考',
    '六、给用户的阅读提示',
  ]) {
    assert.ok(md.includes(heading), `报告缺少章节：${heading}`);
  }

  // 基础信息与平台评分必须是表格
  assert.ok(md.includes('| 项目 | 内容 |'));
  assert.ok(md.includes('| 平台 | 评分 | 评价摘要（去剧透） |'));
  // 标签必须用反引号包裹
  assert.ok(md.includes('`密室`'));
  assert.ok(md.includes('`洋馆`'));
  // 无数据的平台要标注「暂无数据」
  assert.ok(md.includes('暂无数据'));
});

test('renderReport：不得包含保险库内容', () => {
  const book = makeBook('t', ['locked-room'], { title: '保密测试', vault: { culprit: '绝对不该出现的名字' } });
  const md = renderReport({ book, recommendations: [] });
  assert.ok(!md.includes('绝对不该出现的名字'));
});

test('renderRecommendations：输出 3 本并标注匹配标签与理由', () => {
  const recs = ['甲', '乙', '丙'].map((name, i) => ({
    book: { id: `b${i}`, title: name, author: '作者' + i },
    reason: '核心诡计同属 `密室` 机制。',
    detail: { matched: ['locked-room', 'mansion'] },
    percent: 90 - i * 7,
    confidence: { level: 'high', label: '高度相似' },
  }));
  const md = renderRecommendations(recs, 3);
  assert.ok(md.includes('**《甲》**'));
  assert.ok(md.includes('**《乙》**'));
  assert.ok(md.includes('**《丙》**'));
  assert.ok(md.includes('`密室`'));
  assert.ok(!md.includes('**《丁》**'));
});

test('markdownToHtml：转义 HTML 且正确解析子集语法', () => {
  const md = [
    '# 标题',
    '',
    '| 项目 | 内容 |',
    '|------|------|',
    '| 书名 | 测试 |',
    '',
    '- 项目一 **加粗**',
    '  - 嵌套项',
    '',
    '> 引用文字',
    '',
    '<script>alert(1)</script>',
  ].join('\n');

  const html = markdownToHtml(md);
  assert.ok(html.includes('<h1>标题</h1>'));
  assert.ok(html.includes('<th>项目</th>'));
  assert.ok(html.includes('<strong>加粗</strong>'));
  assert.ok(html.includes('<ul class="nested">'));
  assert.ok(html.includes('<blockquote>'));
  assert.ok(!html.includes('<script>'), '原始 HTML 必须被转义');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('renderTagList：用反引号包裹标签', () => {
  assert.equal(renderTagList(['密室', '孤岛']), '`密室` `孤岛`');
  assert.equal(renderTagList([]), '—');
  assert.equal(renderTagList(null), '—');
});

/* ------------------------------------------------------------------ */
/* 标签推断                                                            */
/* ------------------------------------------------------------------ */

test('suggestTags：从梗概中推断出明确标签', () => {
  const text = '十名互不相识的人受邀来到一座与外界隔绝的孤岛，主人始终没有露面，随后有人依照一首童谣接连死去。';
  const suggestions = suggestTags(text);
  const ids = suggestions.map((s) => s.id);
  assert.ok(ids.includes('isolated-island'), `应推断出孤岛：${ids.join(',')}`);
  assert.ok(ids.includes('nursery-rhyme'), `应推断出童谣：${ids.join(',')}`);
  const closedCircle = suggestions.find((s) => s.id === 'closed-circle');
  assert.ok(closedCircle, '应推断出封闭环境');
  assert.equal(closedCircle.level, 'high');
});

test('suggestTags：无信号文本返回空数组（宁可说信息有限，也不臆测）', () => {
  assert.deepEqual(suggestTags('这是一本很好看的书。'), []);
  assert.deepEqual(suggestTags(''), []);
});

/* ------------------------------------------------------------------ */
/* 数据规范化                                                          */
/* ------------------------------------------------------------------ */

test('normalizeSeedBook：补齐缺省字段并去重标签', () => {
  const book = normalizeSeedBook({ id: 'a', title: 'B', tags: ['locked-room', 'locked-room'] });
  assert.ok(book);
  assert.deepEqual(book.tags, ['locked-room']);
  assert.equal(book.author, '佚名');
  assert.deepEqual(book.vault, { culprit: '', coreTrick: '', ending: '', notes: '' });
  assert.deepEqual(book.readingTips.watchFor, []);
  assert.equal(book.recommendable, true);
});

test('normalizeSeedBook：缺少 id 或书名返回 null', () => {
  assert.equal(normalizeSeedBook({ title: 'X' }), null);
  assert.equal(normalizeSeedBook({ id: 'x' }), null);
  assert.equal(normalizeSeedBook(null), null);
});

test('splitSchoolTags：按类别把流派从 tags 中拆出', () => {
  const s = splitSchoolTags(['locked-room', 'logic-school', 'red-herring', 'social-school']);
  assert.deepEqual(s.tags, ['locked-room', 'red-herring']);
  assert.deepEqual(s.school, ['logic-school', 'social-school']);
  // 空值与非字符串不应导致异常
  assert.deepEqual(splitSchoolTags([]), { tags: [], school: [] });
  assert.deepEqual(splitSchoolTags([null, undefined, '', 'locked-room']), { tags: ['locked-room'], school: [] });
});

test('splitAuthors：按「、，,;；」拆作者，但绝不拆「·」', () => {
  assert.deepEqual(splitAuthors('马伊·舍瓦尔、佩尔·瓦勒'), ['马伊·舍瓦尔', '佩尔·瓦勒']);
  assert.deepEqual(splitAuthors('博尔赫斯，比奥伊·卡萨雷斯'), ['博尔赫斯', '比奥伊·卡萨雷斯']);
  // 关键回归：西方人名的间隔号不能被当成分隔符，否则作者会被撕成两半
  assert.deepEqual(splitAuthors('阿加莎·克里斯蒂'), ['阿加莎·克里斯蒂']);
  assert.deepEqual(splitAuthors('约翰·迪克森·卡尔'), ['约翰·迪克森·卡尔']);
  assert.deepEqual(splitAuthors('G·K·切斯特顿'), ['G·K·切斯特顿']);
  assert.deepEqual(splitAuthors(''), []);
  assert.deepEqual(splitAuthors(null), []);
});

test('normalizeSeedBook：多作者模型 —— author 是标签、authors 是统计口径', () => {
  const base = { id: 'x1', title: '失踪的消防车', genre: '犯罪悬疑', safeSummary: '测试用简介文本。' };
  // ① 只写 author（老数据形状）：单作者时两字段一致
  const solo = normalizeSeedBook({ ...base, author: '阿加莎·克里斯蒂' });
  assert.equal(solo.author, '阿加莎·克里斯蒂');
  assert.deepEqual(solo.authors, ['阿加莎·克里斯蒂']);

  // ② author 里写了多位：归一化时自愈出 authors 数组
  const healed = normalizeSeedBook({ ...base, author: '马伊·舍瓦尔、佩尔·瓦勒' });
  assert.equal(healed.author, '马伊·舍瓦尔、佩尔·瓦勒');
  assert.deepEqual(healed.authors, ['马伊·舍瓦尔', '佩尔·瓦勒']);

  // ③ 显式给 authors：以数组为准，author 允许是「等」这类简写标签
  const explicit = normalizeSeedBook({ ...base, author: '江户川乱步 等', authors: ['江户川乱步', '大阪圭吉', '小酒井不木'] });
  assert.equal(explicit.author, '江户川乱步 等');
  assert.deepEqual(explicit.authors, ['江户川乱步', '大阪圭吉', '小酒井不木']);

  // ④ 幂等：本函数会被喂进已经规范化过的对象（服务端/导入路径）
  const twice = normalizeSeedBook(explicit);
  assert.equal(twice.author, explicit.author);
  assert.deepEqual(twice.authors, explicit.authors);
});

test('collabLabel：合著与合集给出不同徽章文案，单作者无徽章', () => {
  const solo = normalizeSeedBook({ id: 'x', title: 'T', author: '阿加莎·克里斯蒂', genre: '本格推理', safeSummary: '测试。' });
  assert.equal(collabLabel(solo), null, '单作者不应有徽章');

  // 两三人合写完整本书 → 合著
  const co = normalizeSeedBook({
    id: 'x', title: 'T', author: '马伊·舍瓦尔、佩尔·瓦勒',
    authors: ['马伊·舍瓦尔', '佩尔·瓦勒'], genre: '犯罪悬疑', safeSummary: '测试。',
  });
  assert.equal(collabLabel(co).kind, 'coauthor');
  assert.match(collabLabel(co).text, /^合著/);
  assert.equal(collabLabel(co).detail, '由 马伊·舍瓦尔、佩尔·瓦勒 共同创作');

  // 十几位作家各写一篇 → 合集（由数据显式标注，不靠猜作者个数）
  const an = normalizeSeedBook({
    id: 'x', title: 'T', author: '江户川乱步 等', authors: ['江户川乱步'],
    anthology: true, genre: '本格推理', safeSummary: '测试。',
  });
  assert.equal(collabLabel(an).kind, 'anthology');
  assert.equal(collabLabel(an).text, '合集');
  // 馆藏常常只列一位领衔作者，徽章不能因此就消失，且必须说清「只登记了一位」
  assert.match(collabLabel(an).detail, /仅登记 1 位领衔作者/);

  // anthology 必须严格是 true 才算，字符串 'true' 不算
  const falsy = normalizeSeedBook({ id: 'x', title: 'T', author: '某人', anthology: 'true', genre: '本格推理', safeSummary: '测试。' });
  assert.equal(falsy.anthology, false);
  assert.equal(collabLabel(falsy), null);
});

test('authorListOf / sharedAuthor：聚合一律走作者列表，合著也要连得上', () => {
  const sw = normalizeSeedBook({ id: 'a', title: '失踪的消防车', author: '马伊·舍瓦尔、佩尔·瓦勒', genre: '犯罪悬疑', safeSummary: '测试用简介。' });
  const soloW = normalizeSeedBook({ id: 'b', title: '某独著', author: '佩尔·瓦勒', genre: '犯罪悬疑', safeSummary: '测试用简介。' });
  const other = normalizeSeedBook({ id: 'c', title: '别人的书', author: '阿加莎·克里斯蒂', genre: '犯罪悬疑', safeSummary: '测试用简介。' });

  assert.deepEqual(authorListOf(sw), ['马伊·舍瓦尔', '佩尔·瓦勒']);
  // 合著作品与其中任一作者的独著之间算同作者（交集，而非字符串相等）
  assert.equal(sharedAuthor(sw, soloW), '佩尔·瓦勒');
  assert.equal(sharedAuthor(sw, other), '');
  // 老数据没有 authors 字段时按 author 兜底
  assert.deepEqual(authorListOf({ author: '某人' }), ['某人']);
  assert.deepEqual(authorListOf({}), []);
});

test('normalizeSeedBook：流派被误写进 tags 时自动搬回 schoolTags（自愈）', () => {
  // 回归测试：表单/导入把两个维度混写，会让编辑回填与统计全部错位
  const book = normalizeSeedBook({
    id: 'a',
    title: 'B',
    genre: '本格推理',
    tags: ['locked-room', 'logic-school', 'red-herring'],
  });
  assert.deepEqual(book.tags, ['locked-room', 'red-herring'], 'tags 里不得残留流派 id');
  assert.deepEqual(book.schoolTags, ['logic-school'], '流派应被搬进 schoolTags');
  // 合并视图不受影响，推荐结果不变
  assert.equal(bookTagIds(book).length, 3);
});

test('normalizeSeedBook：school 字段与 tags 中的流派合并去重，非法 id 被丢弃', () => {
  const book = normalizeSeedBook({
    id: 'a',
    title: 'B',
    genre: '本格推理',
    tags: ['locked-room', 'logic-school'],
    school: ['logic-school', 'trick-school', 'not-a-real-tag'],
  });
  assert.deepEqual(book.tags, ['locked-room']);
  assert.deepEqual(book.schoolTags, ['logic-school', 'trick-school']);
});

test('normalizeSeedBook：school 字段正常时不受影响', () => {
  const book = normalizeSeedBook({
    id: 'a',
    title: 'B',
    genre: '本格推理',
    tags: ['locked-room'],
    school: ['logic-school'],
  });
  assert.deepEqual(book.tags, ['locked-room']);
  assert.deepEqual(book.schoolTags, ['logic-school']);
});

test('normalizeSeedBook：幂等 —— 重复规范化不得丢失流派', () => {
  // 回归测试：服务端 getUserBooks() 与 store 的导入/保存都会把**已规范化**的对象
  // 再喂回来一次。早期只认原始字段名 school，不认自己的输出 schoolTags，
  // 于是第二次规范化把流派清空——用户新建的作品一重新拉取就丢失全部流派。
  const once = normalizeSeedBook({
    id: 'a',
    title: 'B',
    genre: '本格推理',
    tags: ['locked-room'],
    school: ['logic-school', 'trick-school'],
  });
  const twice = normalizeSeedBook(once);
  const thrice = normalizeSeedBook(twice);

  assert.deepEqual(twice.schoolTags, once.schoolTags, '第二次规范化丢失了流派');
  assert.deepEqual(thrice.schoolTags, once.schoolTags, '第三次规范化丢失了流派');
  assert.deepEqual(twice.tags, once.tags);
  assert.deepEqual(thrice.tags, once.tags);
  assert.equal(JSON.stringify(once), JSON.stringify(twice), 'normalizeSeedBook 不是幂等的');
});

test('canonicalGenre：流派归一化，且「新本格」不被「本格」吞掉', () => {
  // 顺序回归测试：词表里「新本格」必须排在「本格推理」之前
  assert.equal(canonicalGenre('新本格'), '新本格');
  assert.equal(canonicalGenre('新本格推理'), '新本格');
  assert.equal(canonicalGenre('本格推理'), '本格推理');
  assert.equal(canonicalGenre('本格推理（不可能犯罪）'), '本格推理');
  assert.equal(canonicalGenre('不可能犯罪'), '本格推理');
  assert.equal(canonicalGenre('古典本格'), '本格推理');

  // 各类变体收敛到同一标准值
  assert.equal(canonicalGenre('社会派推理'), '社会派');
  assert.equal(canonicalGenre('社会派推理小说'), '社会派');
  assert.equal(canonicalGenre('心理惊悚'), '犯罪悬疑');
  assert.equal(canonicalGenre('悬疑推理'), '犯罪悬疑');
  assert.equal(canonicalGenre('北欧犯罪'), '犯罪悬疑');
  assert.equal(canonicalGenre('幽默推理'), '日常之谜');
  assert.equal(canonicalGenre('硬汉派'), '硬汉派');
  assert.equal(canonicalGenre('历史推理'), '历史推理');

  // 兜底
  assert.equal(canonicalGenre(''), '其他');
  assert.equal(canonicalGenre('某种不存在的流派'), '其他');
  assert.equal(canonicalGenre(null), '其他');
});

test('canonicalGenre：本身就是受控值时必须原样返回（不被更宽泛的词吞掉）', () => {
  // 回归测试：「冒险悬疑」曾因包含「悬疑」而被「犯罪悬疑」抢先命中，
  // 结果自己反被改掉，导致「冒险悬疑」这个受控值永远筛不出任何书。
  for (const label of GENRE_OPTIONS) {
    assert.equal(canonicalGenre(label), label, `受控值「${label}」不应被改成其他值`);
  }
  assert.equal(canonicalGenre('冒险悬疑'), '冒险悬疑');
  assert.equal(canonicalGenre('恐怖'), '恐怖');
  assert.equal(canonicalGenre('间谍小说'), '间谍小说');
});

test('canonicalGenre：归一化结果始终落在受控词表内', () => {
  const samples = [
    '本格推理', '新本格', '社会派', '硬汉派', '变格', '青春推理',
    '日常之谜', '犯罪悬疑', '冒险悬疑', '历史推理', '间谍小说', '恐怖', '其他',
  ];
  for (const sample of samples) {
    assert.ok(GENRE_OPTIONS.includes(sample) || sample === '其他', `${sample} 不在受控词表中`);
  }
  // 任意输入的输出都必须是词表成员或「其他」
  for (const weird of ['本格', '社会', '推', '侦探', 'xyz', '   ']) {
    const out = canonicalGenre(weird);
    assert.ok(GENRE_OPTIONS.includes(out) || out === '其他', `${weird} → ${out} 不在受控词表中`);
  }
});

test('normalizeSeedBook：流派归一化并保留原始写法', () => {
  const book = normalizeSeedBook({ id: 'a', title: 'B', genre: '本格推理（不可能犯罪）' });
  assert.equal(book.genre, '本格推理');
  assert.equal(book.genreDetail, '本格推理（不可能犯罪）', '原始流派写法应保留在 genreDetail 中');
});

/* ---------------- 系列名归一化 ---------------- */

test('canonicalSeries：非系列作品的写法统一归为空字符串', () => {
  for (const text of ['非系列', '独立作（非系列）', '独立作（非菲尔博士系列）', '非系列作品', '独立作品', '']) {
    assert.equal(canonicalSeries(text), '', `「${text}」应归为非系列`);
  }
});

test('canonicalSeries：同系列的不同写法归到同一规范名', () => {
  const groups = [
    [['罗飞系列', '刑警罗飞系列'], '刑警罗飞系列'],
    [['亨利·梅利维尔系列', '亨利·梅利维尔爵士系列', '梅利维尔系列'], '亨利·梅利维尔爵士系列'],
    [['菲洛·凡斯系列', '菲洛·万斯系列'], '菲洛·凡斯系列'],
    [['马普尔小姐系列', '玛普尔小姐系列'], '玛普尔小姐系列'],
    [['赫尔克里·波洛系列', '波洛系列'], '赫尔克里·波洛系列'],
    [['哈利·霍尔系列', '哈利·霍勒系列'], '哈利·霍勒系列'],
  ];
  for (const [variants, expected] of groups) {
    for (const v of variants) {
      assert.equal(canonicalSeries(v), expected, `「${v}」应归一为「${expected}」`);
    }
  }
});

test('canonicalSeries：原样保留无法归一的系列名', () => {
  assert.equal(canonicalSeries('馆系列'), '馆系列');
  assert.equal(canonicalSeries('百鬼夜行系列'), '百鬼夜行系列');
  assert.equal(canonicalSeries('  千禧年系列  '), '千禧年系列');
});

test('sameSeries：写法差异不影响同系列判断（推荐算法依赖）', () => {
  // 同系列：不同写法必须判为 true，否则推荐里会出现"同系列续作"
  assert.equal(sameSeries('罗飞系列', '刑警罗飞系列'), true);
  assert.equal(sameSeries('亨利·梅利维尔系列', '亨利·梅利维尔爵士系列'), true);
  assert.equal(sameSeries('菲洛·凡斯系列', '菲洛·万斯系列'), true);
  assert.equal(sameSeries('马普尔小姐系列', '玛普尔小姐系列'), true);

  // 非系列作品之间不能因为都为空而误判为同系列
  assert.equal(sameSeries('非系列', '独立作（非系列）'), false);
  assert.equal(sameSeries('', ''), false);
  assert.equal(sameSeries(null, undefined), false);

  // 不同系列
  assert.equal(sameSeries('馆系列', '百鬼夜行系列'), false);
  assert.equal(sameSeries('赫尔克里·波洛系列', '玛普尔小姐系列'), false);
});

/* ------------------------------------------------------------------ */
/* html`` / raw()：模板渲染契约（[object Object] 事故回归测试）        */
/* ------------------------------------------------------------------ */

/**
 * html`` 返回的是 SafeHtml（继承 String，带 RAW 标记）。
 * 用 String() 显式取原始值再做严格比较，避免包装对象与原始字符串比较失败。
 */
const s = (safe) => String(safe);

test('html``：普通插值会被转义', () => {
  const out = s(html`<p>${'<script>alert(1)</script>'}</p>`);
  assert.ok(out.includes('&lt;script&gt;'));
  assert.ok(!out.includes('<script>'));
});

test('html``：raw() 插值原样输出', () => {
  assert.equal(s(html`<div>${raw('<b>粗体</b>')}</div>`), '<div><b>粗体</b></div>');
});

test('html``：数组插值会逐项处理（不会出现 [object Object]）', () => {
  const items = ['a', 'b', 'c'];
  const out = s(html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>`);
  // 嵌套的 html`` 不应被二次转义
  assert.equal(out, '<ul><li>a</li><li>b</li><li>c</li></ul>');
  assert.ok(!out.includes('[object Object]'));
  assert.ok(!out.includes('&lt;li&gt;'), '嵌套的 html`` 被二次转义了');
});

test('html``：本系统推荐的数组写法正确（本次事故的回归测试）', () => {
  const rows = ['x', 'y'].map((t) => raw(`<span>${t}</span>`));
  // ✅ 推荐写法：直接把数组交给插值，递归处理，RAW 标记保留
  assert.equal(s(html`<div>${rows}</div>`), '<div><span>x</span><span>y</span></div>');
  assert.ok(!s(html`<div>${rows}</div>`).includes('[object Object]'));

  // ✅ 确实需要 join 时，用 raw() 显式再包一层
  assert.equal(s(html`<div>${raw(rows.join(''))}</div>`), '<div><span>x</span><span>y</span></div>');
});

test('html``：join 之后 RAW 标记会丢失并被转义（刻意的安全设计）', () => {
  const rows = ['x', 'y'].map((t) => raw(`<span>${t}</span>`));

  // join('') 的结果是普通字符串，插值时会被转义 —— 这是正确行为，
  // 否则任何字符串拼接都能绕过转义，等于开了一个 XSS 后门。
  const viaJoin = s(html`<div>${rows.join('')}</div>`);
  assert.equal(viaJoin, '<div>&lt;span&gt;x&lt;/span&gt;&lt;span&gt;y&lt;/span&gt;</div>');
  assert.ok(!viaJoin.includes('[object Object]'), '不应再出现 [object Object]');
  assert.ok(!viaJoin.includes('<span>'), 'join 后的字符串不应被当作可信 HTML');
});

test('html``：嵌套多层数组与 raw 都能正确处理', () => {
  const deep = [
    [raw('<i>1</i>'), html`<i>${2}</i>`],
    [raw('<i>3</i>')],
  ];
  const out = s(html`<p>${deep}</p>`);
  assert.equal(out, '<p><i>1</i><i>2</i><i>3</i></p>');
  assert.ok(!out.includes('[object Object]'));
});

test('html``：SafeHtml 可以像普通字符串一样使用', () => {
  const out = html`<p>${1}</p>`;
  assert.equal(typeof out, 'object');
  assert.equal(out.length, 8);
  assert.ok(out.includes('<p>'));
  assert.ok(out.startsWith('<p>'));
  assert.equal(`${out}`, '<p>1</p>');
});

test('raw()：结果带有可用的 toString，放进数组也不会退化', () => {
  const r = raw('<b>hi</b>');
  assert.equal(String(r), '<b>hi</b>');
  assert.equal(`${r}`, '<b>hi</b>');
  assert.equal([r, r].join(''), '<b>hi</b><b>hi</b>');
  assert.equal([r].toString(), '<b>hi</b>');
});

test('html``：null / undefined / false 渲染为空字符串', () => {
  assert.equal(s(html`<p>${null}${undefined}${false}</p>`), '<p></p>');
  assert.equal(s(html`<p>${0}</p>`), '<p>0</p>');
});

test('esc：五个危险字符都被转义', () => {
  assert.equal(esc('<>&"\''), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(0), '0');
});

/* ------------------------------------------------------------------ */
/* 静态资源版本化（缓存失效）                                          */
/* ------------------------------------------------------------------ */

test('versionAssets：HTML 里的 css/js 引用被附加版本号', () => {
  const html = [
    '<link rel="stylesheet" href="css/styles.css" />',
    '<link rel="stylesheet" href="css/print.css" media="print" />',
    '<script type="module" src="js/app.js"></script>',
    '<link rel="icon" href="assets/favicon.svg" />',
    '<a href="#/library">知识库</a>',
    '<img src="https://example.com/a.js" />',
  ].join('\n');
  const out = versionAssets(html, 'v123');

  assert.ok(out.includes('href="css/styles.css?v=v123"'));
  assert.ok(out.includes('href="css/print.css?v=v123"'));
  assert.ok(out.includes('src="js/app.js?v=v123"'));
  // 非 css/js 与外部地址、锚点不应被改动
  assert.ok(out.includes('href="assets/favicon.svg"'));
  assert.ok(out.includes('href="#/library"'));
  assert.ok(out.includes('src="https://example.com/a.js"'));
});

test('versionModuleImports：静态 import / re-export / 副作用导入都被版本化', () => {
  const source = [
    "import { store } from './core/store.js';",
    "import { html } from './ui/dom.js';",
    "export { SEED_FILES } from './seed-files.js';",
    "import './side-effect.js';",
    "import path from 'node:path';",
    "import fs from 'node:fs/promises';",
  ].join('\n');
  const out = versionModuleImports(source, 'v123');

  assert.ok(out.includes("'./core/store.js?v=v123'"), '静态 import 应被版本化');
  assert.ok(out.includes("'./ui/dom.js?v=v123'"));
  assert.ok(out.includes("'./seed-files.js?v=v123'"), 're-export 应被版本化');
  assert.ok(out.includes("'./side-effect.js?v=v123'"), '副作用导入应被版本化');
  // 裸包名不应被改动
  assert.ok(out.includes("'node:path'"));
  assert.ok(out.includes("'node:fs/promises'"));
});

test('versionModuleImports：动态 import() 必须被版本化（漏掉它深层模块就不会更新）', () => {
  // 这是最容易被漏掉的形态：`import` 后面直接跟 `(`，不是引号
  const source = [
    "const mod = await import('./views/analyze.js');",
    "  analyze: { load: () => import('./views/analyze.js') },",
    '  library: { load: () => import("./views/library.js") },',
  ].join('\n');
  const out = versionModuleImports(source, 'v123');

  assert.equal((out.match(/\?v=v123/g) ?? []).length, 3, '三条动态 import 都应被版本化');
  assert.ok(out.includes("'./views/analyze.js?v=v123'"));
  assert.ok(out.includes('"./views/library.js?v=v123"'), '双引号形式也要处理');
});

test('versionModuleImports：不重复追加版本号', () => {
  const once = versionModuleImports("import a from './a.js';", 'v1');
  const twice = versionModuleImports(once, 'v1');
  assert.equal((twice.match(/\?v=/g) ?? []).length, 1);
});

test('versionModuleImports：对真实源码能把整条模块图全覆盖', () => {
  // 用 app.js 的真实内容做端到端校验
  const appSource = readFileSync(new URL('../web/js/app.js', import.meta.url), 'utf8');
  const rewritten = versionModuleImports(appSource, 'vTEST');

  // 找出所有相对 import 说明符，重写后必须全部带版本号
  const remaining = [...rewritten.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*(['"])(\.{1,2}\/[^'"]+\.js)\1/g)].filter(
    (m) => !m[2].includes('?v='),
  );
  assert.equal(remaining.length, 0, `仍有未版本化的相对导入：${remaining.map((m) => m[2]).join(', ')}`);
  assert.ok((rewritten.match(/\?v=vTEST/g) ?? []).length >= 5, 'app.js 的相对导入应不少于 5 条');
});

test('标签覆盖率：字典规模与分类数量符合设计', () => {
  const byCat = TAGS.reduce((acc, t) => {
    acc[t.category] = (acc[t.category] ?? 0) + 1;
    return acc;
  }, {});
  assert.ok(byCat.trick >= 14, `诡计类标签应不少于 14 个，实际 ${byCat.trick}`);
  assert.ok(byCat.narrative >= 7, `叙事类标签应不少于 7 个，实际 ${byCat.narrative}`);
  assert.ok(byCat.scene >= 9, `场景类标签应不少于 9 个，实际 ${byCat.scene}`);
  assert.ok(byCat.motive >= 7, `动机类标签应不少于 7 个，实际 ${byCat.motive}`);
  assert.ok(byCat.school >= 10, `推理流派标签应不少于 10 个，实际 ${byCat.school}`);
  assert.equal(tagCategory('locked-room'), 'trick');
  assert.equal(tagCategory('logic-school'), 'school');
  assert.equal(tagCategory('legal-thriller'), 'school');
  assert.equal(tagLabel('locked-room'), '密室');
  assert.deepEqual(tagLabels(['locked-room', 'mansion']), ['密室', '洋馆']);
});

test('推理流派：与诡计类是正交维度，权重定位正确', () => {
  const schoolTags = TAGS.filter((t) => t.category === 'school');
  assert.ok(schoolTags.length >= 10, `流派标签应不少于 10 个，实际 ${schoolTags.length}`);

  // 需求中明确提到的流派必须存在
  const labels = new Set(schoolTags.map((t) => t.label));
  for (const required of ['逻辑流', '诡计流', '法庭派', '硬汉派', '刑侦派']) {
    assert.ok(labels.has(required), `缺少需求中提到的流派：${required}`);
  }

  // 权重定位：低于诡计与叙事（不喧宾夺主），高于场景与题材（比它们更有区分度）
  assert.ok(CATEGORY_MAP.school.weight < CATEGORY_MAP.trick.weight);
  assert.ok(CATEGORY_MAP.school.weight < CATEGORY_MAP.narrative.weight);
  assert.ok(CATEGORY_MAP.school.weight > CATEGORY_MAP.scene.weight);
  assert.ok(CATEGORY_MAP.school.weight > CATEGORY_MAP.theme.weight);
});

/* ------------------------------------------------------------------ */
/* 平台评分解析（实时抓取层）                                          */
/* ------------------------------------------------------------------ */

/** 豆瓣详情页的真实片段（取自 book.douban.com/subject/3006581/） */
const DOUBAN_HTML = `
<!DOCTYPE html><html><head><title>无人生还 (豆瓣)</title></head><body>
<div id="wrapper">
  <h1><span property="v:itemreviewed">无人生还</span></h1>
  <div class="rating_wrap clearbox">
    <div class="rating">
      <strong class="ll rating_num" property="v:average">9.0</strong>
      <span property="v:votes">170787</span>
      <a class="rating_people" href="comments"><span>170787</span>人评价</a>
    </div>
  </div>
</div></body></html>`;

/** 另一种写法：class 顺序不同、评分在人评价之前 */
const DOUBAN_HTML_VARIANT = `
<html><body>
<strong class="rating_num ">8.3</strong>
<span>28521</span>人评价
<span property="v:itemreviewed">钟表馆事件</span>
</body></html>`;

/** 反爬页面 */
const DOUBAN_BLOCKED = `<html><body><h1>检测到有异常请求</h1><p>请稍后再试</p>${'x'.repeat(300)}</body></html>`;

test('parseCount：支持千分位、万、k 等单位', () => {
  assert.equal(parseCount('170787'), 170787);
  assert.equal(parseCount('1,234,567'), 1234567);
  assert.equal(parseCount('12.5万'), 125000);
  assert.equal(parseCount('2万'), 20000);
  assert.equal(parseCount('3.4k'), 3400);
  assert.equal(parseCount(''), null);
  assert.equal(parseCount(null), null);
  assert.equal(parseCount('没有数字'), null);
});

test('stripTags：剥离标签与解码实体', () => {
  assert.equal(stripTags('<b>密室</b>&nbsp;杀人'), '密室 杀人');
  assert.equal(stripTags('<span>a</span><script>evil()</script>b'), 'a b');
  assert.equal(stripTags('&lt;script&gt;'), '<script>');
});

test('parseDoubanSubject：从真实页面结构解析评分与评价人数', () => {
  const parsed = parseDoubanSubject(DOUBAN_HTML, { subjectId: '3006581' });
  assert.ok(parsed, '应当解析成功');
  assert.equal(parsed.score, 9.0);
  assert.equal(parsed.count, 170787);
  assert.equal(parsed.title, '无人生还');
  assert.equal(parsed.subjectId, '3006581');
  assert.equal(parsed.sourceUrl, 'https://book.douban.com/subject/3006581/');
  assert.ok(parsed.fetchedAt, '必须带抓取时间');
});

test('parseDoubanSubject：兼容 class 顺序与结构不同的页面', () => {
  const parsed = parseDoubanSubject(DOUBAN_HTML_VARIANT, { subjectId: '999' });
  assert.ok(parsed);
  assert.equal(parsed.score, 8.3);
  assert.equal(parsed.count, 28521);
  assert.equal(parsed.title, '钟表馆事件');
});

test('parseDoubanSubject：反爬页面必须返回 null，不得猜测分数', () => {
  assert.equal(parseDoubanSubject(DOUBAN_BLOCKED), null);
  assert.equal(parseDoubanSubject(''), null);
  assert.equal(parseDoubanSubject('   '), null);
  // 内容很长但不含任何评分块标记的页面（例如登录墙）也要拒绝
  assert.equal(parseDoubanSubject(`<html><body>${'登录后才能查看'.repeat(60)}</body></html>`), null);
  assert.equal(parseDoubanSubject(null), null);
});

test('parseDoubanSubject：评分超出 0~10 一律判定为解析失败', () => {
  const weird = DOUBAN_HTML.replace('>9.0<', '>90.0<');
  assert.equal(parseDoubanSubject(weird), null, '90 分显然不是合法豆瓣评分，应拒绝而不是照抄');
});

test('parseDoubanSuggest：解析检索接口返回的候选列表', () => {
  const payload = JSON.stringify([
    { title: '无人生还', url: 'https://book.douban.com/subject/3006581/', author_name: '[英] 阿加莎·克里斯蒂', year: '2008', type: 'b', id: '3006581' },
    { title: '无人生还', url: 'https://book.douban.com/subject/26840298/', author_name: '[英] 阿加莎·克里斯蒂', year: '2016', type: 'b', id: '26840298' },
  ]);
  const parsed = parseDoubanSuggest(payload);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, '3006581');
  assert.equal(parsed[0].title, '无人生还');
  assert.ok(parsed[0].url.startsWith('https://book.douban.com/subject/'));
  // 非法输入不应抛错
  assert.deepEqual(parseDoubanSuggest('not json'), []);
  assert.deepEqual(parseDoubanSuggest({}), []);
  assert.deepEqual(parseDoubanSuggest(null), []);
});

test('parseDoubanOtherEditions：抽取其他版本列表', () => {
  const html = `
    <div class="works">
      <li><a href="https://book.douban.com/subject/24859822/">新星出版社 （2013）</a><span>8.7分 187748人读过</span></li>
      <li><a href="https://book.douban.com/subject/1573689/">Harper （2003）</a><span>8.9分 3373人读过</span></li>
    </div>`;
  const editions = parseDoubanOtherEditions(html);
  assert.equal(editions.length, 2);
  assert.equal(editions[0].subjectId, '24859822');
  assert.equal(editions[0].count, 187748);
  assert.equal(editions[1].score, 8.9);
});

test('parseWereadBook：推荐值解析，拿不到时返回 null', () => {
  assert.equal(parseWereadBook('{"recommendPercent":89.5}').score, 89.5);
  assert.equal(parseWereadBook('推荐值 92.3%').score, 92.3);
  assert.equal(parseWereadBook('<html>页面需要登录</html>'), null);
  assert.equal(parseWereadBook(''), null);
});

test('validateRating：量纲、精度与来源追溯都会检查', () => {
  // 合法
  assert.equal(validateRating('douban', { score: 9, count: 1000, sourceUrl: 'https://x' }).ok, true);
  assert.equal(validateRating('goodreads', { score: 4.28, count: 10, sourceUrl: 'https://x' }).ok, true);
  // 缺来源
  assert.equal(validateRating('douban', { score: 9, count: 1, sourceUrl: null }).ok, false);
  // 超出量纲
  assert.equal(validateRating('goodreads', { score: 9, count: 1, sourceUrl: 'https://x' }).ok, false);
  assert.equal(validateRating('douban', { score: 92, count: 1, sourceUrl: 'https://x' }).ok, false);
  // 精度过高
  assert.equal(validateRating('douban', { score: 9.13, count: 1, sourceUrl: 'https://x' }).ok, false);
  // 人数非法
  assert.equal(validateRating('douban', { score: 9, count: -3, sourceUrl: 'https://x' }).ok, false);
  // 没有评分
  assert.equal(validateRating('douban', { score: null, count: 1, sourceUrl: 'https://x' }).ok, false);
  // 未知平台
  assert.equal(validateRating('nosuch', { score: 1, count: 1, sourceUrl: 'https://x' }).ok, false);
});

test('validateBatch：检出豆瓣与 Goodreads 数值写反的串台错误', () => {
  // Goodreads 是 5 分制，9.0 本身就超出量纲 —— 应被逐条校验拦下
  const result = validateBatch([
    { id: 'b1', title: '测试', platform: 'douban', score: 4.2, count: 100, sourceUrl: 'https://d' },
    { id: 'b1', title: '测试', platform: 'goodreads', score: 9.0, count: 100, sourceUrl: 'https://g' },
  ]);
  assert.equal(result.valid.length, 1, '只有豆瓣那条合法');
  assert.equal(result.failures.length, 1);
  assert.ok(result.failures[0].reasons.some((r) => r.includes('超出')));
});

test('validateBatch：两个平台都合法但数值关系反常时给出串台提醒', () => {
  // 豆瓣 4.2/10 低于 Goodreads 4.9/5 —— 关系反常，提示疑似写反
  const result = validateBatch([
    { id: 'b2', title: '测试2', platform: 'douban', score: 4.2, count: 100, sourceUrl: 'https://d' },
    { id: 'b2', title: '测试2', platform: 'goodreads', score: 4.9, count: 100, sourceUrl: 'https://g' },
  ]);
  const cross = result.failures.find((f) => f.platform === 'cross-check');
  assert.ok(cross, '应当给出串台提醒');
  assert.ok(cross.reasons[0].includes('写反'));
});

test('PLATFORM_RULES：平台量纲定义正确', () => {
  assert.equal(PLATFORM_RULES.douban.max, 10);
  assert.equal(PLATFORM_RULES.goodreads.max, 5);
  assert.equal(PLATFORM_RULES.weread.max, 100);
});

/* ------------------------------------------------------------------ */
/* 抓取候选筛选（防张冠李戴）                                          */
/* ------------------------------------------------------------------ */

test('looksLikeDifferentBook：同书不同译名必须放行（虚词增减）', () => {
  const cases = [
    // 正规译名去掉了「之」——真实漏抓事故
    [{ title: '砂器', author: '松本清张' }, { title: '砂之器', author: '松本清张' }],
    [{ title: '砂器', author: '(日)松本清张' }, { title: '砂之器', author: '松本清张' }],
    // 副标题分隔符差异
    [{ title: '心理罪：画像', author: '雷米' }, { title: '心理罪·画像', author: '雷米' }],
    // 数字写法差异（骨架比对会忽略标点）
    [{ title: '19年间谋杀小叙', author: '那多' }, { title: '十九年间谋杀小叙', author: '那多' }],
    // 括号补充说明
    [{ title: '魍魉之匣（上）', author: '京极夏彦' }, { title: '魍魉之匣', author: '京极夏彦' }],
  ];
  for (const [candidate, book] of cases) {
    const verdict = looksLikeDifferentBook(candidate, book);
    assert.equal(verdict.reject, false, `不应否决：${candidate.title} → ${verdict.reason ?? ''}`);
  }
});

test('looksLikeDifferentBook：不同书的相似书名仍要否决', () => {
  // 《杀死一只知更鸟》vs《知更鸟》
  assert.equal(
    looksLikeDifferentBook({ title: '杀死一只知更鸟', author: '[美] 哈珀·李' }, { title: '知更鸟', author: '尤·奈斯博' }).reject,
    true,
  );
  // 《火车》vs《火车上的女孩》
  assert.equal(
    looksLikeDifferentBook({ title: '火车上的女孩', author: '宝拉·霍金斯' }, { title: '火车', author: '宫部美雪' }).reject,
    true,
  );
  // 《无人生还》vs《无人逝去》
  assert.equal(
    looksLikeDifferentBook({ title: '无人逝去', author: '白井智之' }, { title: '无人生还', author: '阿加莎·克里斯蒂' }).reject,
    true,
  );
});

test('looksLikeDifferentBook：拦住同名前缀的无关书（《知更鸟》事故回归测试）', () => {
  // 真实事故：检索「知更鸟」，豆瓣第一条是哈珀·李《杀死一只知更鸟》
  const verdict = looksLikeDifferentBook(
    { title: '杀死一只知更鸟', author: '[美] 哈珀·李' },
    { title: '知更鸟', author: '尤·奈斯博' },
  );
  assert.equal(verdict.reject, true, '必须否决这本无关的书');
  assert.ok(/另一本书|作者不匹配/.test(verdict.reason ?? ''));
});

test('looksLikeDifferentBook：同书不同版本必须放行', () => {
  const cases = [
    [{ title: '无人生还', author: '[英] 阿加莎·克里斯蒂' }, { title: '无人生还', author: '阿加莎·克里斯蒂' }],
    [{ title: '无人生还', author: '阿加莎·克里斯蒂' }, { title: '无人生还', author: '阿加莎·克里斯蒂' }],
    [{ title: '钟表馆事件', author: '绫辻行人' }, { title: '钟表馆事件', author: '绫辻行人' }],
    // 副标题写法
    [{ title: '首无·作祟之物', author: '三津田信三' }, { title: '首无作祟之物', author: '三津田信三' }],
    // 繁体
    [{ title: '惡魔的手毬歌', author: '橫溝正史' }, { title: '恶魔的手毬歌', author: '横沟正史' }],
    // 候选缺作者信息时不应直接否决（交给评分逻辑判断）
    [{ title: '无人生还', author: '' }, { title: '无人生还', author: '阿加莎·克里斯蒂' }],
  ];
  for (const [candidate, book] of cases) {
    const verdict = looksLikeDifferentBook(candidate, book);
    assert.equal(verdict.reject, false, `不应否决：${candidate.title} / ${candidate.author} → ${verdict.reason ?? ''}`);
  }
});

test('looksLikeDifferentBook：书名完全不同的一律否决', () => {
  const verdict = looksLikeDifferentBook({ title: '活着', author: '余华' }, { title: '无人生还', author: '阿加莎·克里斯蒂' });
  assert.equal(verdict.reject, true);
});

test('looksLikeDifferentBook：原书名完全一致时，作者中外文名对不上也要放行', () => {
  // 回归测试：豆瓣对原版条目返回作者的外文名（Dorothy L. Sayers），
  // 而库里存的是中文名（多萝西·L·塞耶斯），作者判定必然失败。
  // 早期因此把 26 部「只有外文原版条目」的书全部判成「另一本书」而漏抓。
  const cases = [
    [
      { title: 'Strong Poison', author: 'Dorothy L. Sayers' },
      { title: '剧毒', author: '多萝西·L·塞耶斯', originalTitle: 'Strong Poison' },
    ],
    [
      { title: 'Murder Must Advertise', author: 'Dorothy L. Sayers' },
      { title: '杀人必须宣传', author: '多萝西·L·塞耶斯', originalTitle: 'Murder Must Advertise' },
    ],
    [
      { title: '天使のナイフ', author: '薬丸岳' },
      { title: '天使之刃', author: '药丸岳', originalTitle: '天使のナイフ' },
    ],
    [
      { title: 'Faceless Killers', author: 'Henning Mankell' },
      { title: '无脸杀手', author: '亨宁·曼凯尔', originalTitle: 'Faceless Killers' },
    ],
  ];
  for (const [candidate, book] of cases) {
    const verdict = looksLikeDifferentBook(candidate, book);
    assert.equal(verdict.reject, false, `原书名一致却被否决：${candidate.title} → ${verdict.reason ?? ''}`);
  }
});

test('looksLikeDifferentBook：原书名只是包含关系时，仍要求作者匹配（防止吃掉同前缀的无关书）', () => {
  // 《木桶之谜》的原书名是 The Cask，若放宽成「包含即放行」，
  // 就会吃到爱伦·坡的 The Cask of Amontillado。
  const poe = looksLikeDifferentBook(
    { title: 'The Cask of Amontillado', author: 'Edgar Allan Poe' },
    { title: '木桶之谜', author: '弗里曼·威尔斯·克劳夫茨', originalTitle: 'The Cask' },
  );
  assert.equal(poe.reject, true, '包含关系 + 作者不符，必须否决');

  // 作者对得上时，包含关系应放行（同一部作品的不同题名版本）
  const crofts = looksLikeDifferentBook(
    { title: 'The Cask', author: 'Freeman Wills Crofts' },
    { title: '木桶之谜', author: '弗里曼·威尔斯·克劳夫茨', originalTitle: 'The Cask' },
  );
  assert.equal(crofts.reject, false);
});

test('buildQueries：检索词必须包含原书名（否则外文原版条目永远搜不到）', () => {
  const queries = buildQueries({ title: '剧毒', author: '多萝西·L·塞耶斯', originalTitle: 'Strong Poison' });
  assert.ok(queries.includes('Strong Poison'), `检索词缺原书名：${JSON.stringify(queries)}`);
  const q2 = buildQueries({ title: '天使之刃', author: '药丸岳', originalTitle: '天使のナイフ' });
  assert.ok(q2.includes('天使のナイフ'), `检索词缺原书名：${JSON.stringify(q2)}`);
  // 中文书名仍应排在原书名之前（中文版优先，评价人数通常更多）
  assert.equal(queries[0], '剧毒');
});

test('buildQueries：带中点的作者全名搜不到时，用姓氏兜底（《蟑螂》《刀》踩过的坑）', () => {
  const queries = buildQueries({ title: '蟑螂', author: '尤·奈斯博', originalTitle: 'Kakerlakkene' });
  assert.ok(queries.includes('蟑螂 奈斯博'), `检索词缺「书名 + 姓氏」：${JSON.stringify(queries)}`);
  assert.ok(queries.includes('Kakerlakkene 奈斯博'), `检索词缺「原书名 + 姓氏」：${JSON.stringify(queries)}`);
  // 原有的「书名 + 全名」仍要保留（多数书靠它收敛同名版本）
  assert.ok(queries.includes('蟑螂 尤·奈斯博'));

  // 本身就没有中点/空格的作者名不应产生重复的兜底词
  const plain = buildQueries({ title: '天使之刃', author: '药丸岳', originalTitle: '天使のナイフ' });
  assert.equal(plain.filter((q) => q === '天使之刃 药丸岳').length, 1);
  assert.equal(shortAuthorName('药丸岳'), '');
  assert.equal(shortAuthorName('[挪威] 尤·奈斯博'), '奈斯博');
  assert.equal(shortAuthorName('多萝西·L·塞耶斯'), '塞耶斯');
});

test('buildQueries：只有台版的作品要能靠繁体检索词命中（甲贺三郎踩过的坑）', () => {
  // 战前作家的中文版往往只有台版，豆瓣上是繁体条目；库里按简体登记，
  // 只搜简体必然零结果。因此最后要兜一条繁体写法。
  const queries = buildQueries({
    title: '日本侦探小说选Ⅲ：甲贺三郎作品集1',
    author: '甲贺三郎',
  });
  assert.ok(
    queries.includes('日本偵探小說選Ⅲ：甲賀三郎作品集1'),
    `检索词缺繁体写法：${JSON.stringify(queries)}`,
  );
  // 换算必须整串到位，不能只转一半（早期版本漏了「賀」「館」等字，
  // 转出「日本偵探小說選Ⅲ：甲贺三郎作品集1」这种半繁半简的词，照样搜不到）
  assert.equal(toTraditional('日本侦探小说选Ⅲ：甲贺三郎作品集1'), '日本偵探小說選Ⅲ：甲賀三郎作品集1');
  assert.equal(toTraditional('美术馆'), '美術館');
  // 歧义字必须挑对：館/舘 都归「馆」、麵/面 都归「面」、鐘/鍾 都归「钟」
  assert.equal(toTraditional('钟表馆事件'), '鐘錶館事件', '「钟」应取「鐘」，不是「鍾」');
  assert.equal(toTraditional('怪盗二十面相'), '怪盜二十面相', '「面」不应被换成「麵」');
  assert.equal(toTraditional('两分铜币'), '兩分銅幣', '「币」应取「幣」');
  // 已经是繁体的书名不应产生重复的兜底词
  const trad = buildQueries({ title: '惡魔的手毬歌', author: '橫溝正史' });
  assert.equal(trad.filter((q) => q === '惡魔的手毬歌').length, 1);
});

test('normalizeTitle / normalizeAuthor：归一化规则', () => {
  assert.equal(normalizeTitle('首无·作祟之物'), '首无作祟之物');
  assert.equal(normalizeTitle('《无人生还》'), '无人生还');
  assert.equal(normalizeTitle('13·67'), '1367');
  assert.equal(normalizeAuthor('[英] 阿加莎·克里斯蒂'), '阿加莎克里斯蒂');
  assert.equal(normalizeAuthor('阿加莎·克里斯蒂 著'), '阿加莎克里斯蒂');
  assert.equal(normalizeAuthor('多萝西·L·塞耶斯'), '多萝西l塞耶斯');
});

test('normalizeTitle：繁体条目必须归一到简体（台版书否则会被判成另一本书）', () => {
  // 回归测试：豆瓣上不少推理小说只有繁体条目（台版），
  // 简繁表缺失时 normalizeTitle 原样返回，looksLikeDifferentBook 会以
  // 「书名不匹配」否决候选，导致这些书永远抓不到评分。
  const pairs = [
    ['11張撲克牌', '11张扑克牌'],
    ['王與馬戲團', '王与马戏团'],
    ['巧克力遊戲', '巧克力游戏'],
    ['贖罪奏鳴曲', '赎罪奏鸣曲'],
    ['惡魔的手毬歌', '恶魔的手毬歌'],
    ['體育館的殺人', '体育馆的杀人'],
    ['占星術殺人魔法', '占星术杀人魔法'],
    // 日文汉字与罕见繁体（日版/原版条目）
    ['高瀬舟', '高濑舟'],
    ['神州纐纈城', '神州纐缬城'],
    ['三毛貓推理', '三毛猫推理'],
    ['影子的告發', '影子的告发'],
    // 豆瓣上只有日文原版条目时：书名带「の」、用日文汉字写法
    ['法月綸太郎の冒険', '法月纶太郎的冒险'],
    ['象首迷宮', '象首迷宫'],
    // 台版繁体与日文新字体（《恋入膏肓》《密室狂乱时代的杀人》踩过）
    ['戀入膏肓', '恋入膏肓'],
    ['密室狂亂時代的殺人', '密室狂乱时代的杀人'],
    ['彌勒之掌', '弥勒之掌'],
    ['黒革の手帖', '黑革的手帖'],
  ];
  for (const [trad, simp] of pairs) {
    assert.equal(normalizeTitle(trad), normalizeTitle(simp), `${trad} 未归一到 ${simp}`);
  }
  // 作者名的繁体/日文写法同样要归一，否则作者比对也会失败
  assert.equal(normalizeAuthor('米澤穗信'), normalizeAuthor('米泽穗信'));
  assert.equal(normalizeAuthor('岡嶋二人'), normalizeAuthor('冈嶋二人'));
  assert.equal(normalizeAuthor('國枝 史郎'), normalizeAuthor('国枝史郎'));
  assert.equal(normalizeAuthor('森 鴎外'), normalizeAuthor('森鸥外'));

  // 繁体候选应能通过守卫，而不是被判成另一本书
  for (const [trad, simp] of pairs) {
    const verdict = looksLikeDifferentBook({ title: trad, author: '某作者' }, { title: simp, author: '某作者' });
    assert.equal(verdict.reject, false, `${trad} 被误判为另一本书`);
  }
});

test('cjkToNumber：中文数词转数字（书名骨架比对用）', () => {
  assert.equal(cjkToNumber('十九'), 19);
  assert.equal(cjkToNumber('十'), 10);
  assert.equal(cjkToNumber('二十'), 20);
  assert.equal(cjkToNumber('三十七'), 37);
  assert.equal(cjkToNumber('八'), 8);
  assert.equal(cjkToNumber('两'), 2);
  assert.equal(cjkToNumber('零'), 0);
  assert.equal(cjkToNumber('一百'), 100);
  assert.equal(cjkToNumber('一百零三'), 103);
  assert.equal(cjkToNumber('一千'), 1000);
  // 非法输入返回 null，由调用方回退到原文
  assert.equal(cjkToNumber('abc'), null);
  assert.equal(cjkToNumber(''), null);
  assert.equal(cjkToNumber('十x'), null);
});

test('titleSkeleton 级别的等价判定：阿拉伯数字与中文数词视为同一本书', () => {
  const verdict = looksLikeDifferentBook({ title: '19年间谋杀小叙', author: '那多' }, { title: '十九年间谋杀小叙', author: '那多' });
  assert.equal(verdict.reject, false, '数字写法差异不应判为不同书');
});

/* ================================================================== */
/* 判重规则（scripts/lib/dup-rules.mjs）                                */
/* ================================================================== */

test('判重规则：异名同书必须判为重复（同一原作名，两个中文译名）', () => {
  // 这几组都在库里真实存在过，且各自被收成了两个条目。
  // 《活尸之死》/《生尸之死》同为山口雅也《生ける屍の死》；
  // 《莫尔格街凶杀案》/《莫格街凶杀案》同为爱伦·坡的那一篇；
  // 《球形的荒野》/《一个背叛日本的日本人》同为松本清张《球形の荒野》。
  const cases = [
    [
      { title: '活尸之死', originalTitle: '生ける屍の死', author: '山口雅也' },
      { title: '生尸之死', originalTitle: '生ける屍の死', author: '山口雅也' },
    ],
    [
      { title: '莫尔格街凶杀案', originalTitle: 'The Murders in the Rue Morgue', author: '埃德加·爱伦·坡' },
      { title: '莫格街凶杀案', originalTitle: 'The Murders in the Rue Morgue', author: '爱伦·坡' },
    ],
    [
      { title: '球形的荒野', originalTitle: '球形の荒野', author: '松本清张' },
      { title: '一个背叛日本的日本人', originalTitle: '球形の荒野', author: '松本清张' },
    ],
    [
      { title: '血腥的收获', originalTitle: 'Red Harvest', author: '达希尔·哈米特' },
      { title: '红色收获', originalTitle: 'Red Harvest', author: '达希尔·哈米特' },
    ],
  ];
  for (const [a, b] of cases) {
    assert.ok(duplicateReason(a, b), `《${a.title}》与《${b.title}》未被判为重复`);
    assert.equal(duplicateReason(a, b).rule, 'originalTitle');
  }
});

test('判重规则：系列各卷不得判为重复（原书名互为包含不是依据）', () => {
  // 回归测试：早期规则用「原书名互为包含」，把同一系列的相邻各卷
  // 大批误判成重复（闸门报 34 组，其中 10 组是误报），
  // 报告失去可信度后被整体忽略，结果库里积了 24 组真重复没人处理。
  const notDuplicates = [
    // 巷说百物语系列：四部独立作品
    [
      { title: '巷说百物语', originalTitle: '巷説百物語', author: '京极夏彦' },
      { title: '后巷说百物语', originalTitle: '後巷説百物語', author: '京极夏彦' },
    ],
    [
      { title: '巷说百物语', originalTitle: '巷説百物語', author: '京极夏彦' },
      { title: '续巷说百物语', originalTitle: '続巷説百物語', author: '京极夏彦' },
    ],
    // 青蛙男系列正续作
    [
      { title: '连续“杀人鬼”青蛙男', originalTitle: '連続殺人鬼カエル男', author: '中山七里' },
      { title: '连续“杀人鬼”青蛙男：噩梦再临', originalTitle: '連続殺人鬼カエル男ふたたび', author: '中山七里' },
    ],
    // 同一作品的不同卷／续集
    [
      { title: '天久鹰央的推理病历表', originalTitle: '天久鷹央の推理カルテ', author: '知念实希人' },
      { title: '天久鹰央的推理病历表II', originalTitle: '天久鷹央の推理カルテII', author: '知念实希人' },
    ],
    [
      { title: '废墟中的少女侦探', originalTitle: '廃墟の少女探偵', author: '似鸟鸡' },
      { title: '废墟中的少女侦探2', originalTitle: '廃墟の少女探偵2', author: '似鸟鸡' },
    ],
  ];
  for (const [a, b] of notDuplicates) {
    assert.equal(duplicateReason(a, b), null, `《${a.title}》与《${b.title}》被误判为重复`);
  }
});

test('判重规则：作者不同不得合并（防止同名书被并掉）', () => {
  // 《赎罪》这类书名在推理小说里重复率很高，书名相同不等于同一本书
  assert.equal(
    duplicateReason(
      { title: '赎罪', originalTitle: '贖罪', author: '凑佳苗' },
      { title: '赎罪', originalTitle: '贖罪', author: '某位毫无关系的作者' },
    ),
    null,
  );
  // 译名差异不能被当成不同作者
  assert.equal(
    duplicateReason(
      { title: 'X', originalTitle: '', author: '埃德加·爱伦·坡' },
      { title: 'X', originalTitle: '', author: '爱伦·坡' },
    )?.rule,
    'title',
  );
  // 作者异名表要生效：罗伯特·范·古利克 = 高罗佩
  assert.equal(
    duplicateReason(
      { title: '黄金案', originalTitle: 'The Chinese Gold Murders', author: '罗伯特·范·古利克' },
      { title: '黄金案', originalTitle: 'The Chinese Gold Murders', author: '高罗佩' },
    )?.rule,
    'originalTitle',
  );
});

test('判重规则：选集名守卫（原作名被填成系列名时不得批量合并）', () => {
  // 《思考机器探案集》四卷都填了 The Thinking Machine——那是选集名。
  // 三条以上且书名互不相同，必须判为「疑似选集名」而不是重复。
  const volumes = [
    { title: '思考机器探案集之寒鸦女郎', originalTitle: 'The Thinking Machine' },
    { title: '思考机器探案集之幽灵汽车', originalTitle: 'The Thinking Machine' },
    { title: '思考机器探案集之微笑的上帝', originalTitle: 'The Thinking Machine' },
    { title: '思考机器探案集之致命的密码', originalTitle: 'The Thinking Machine' },
  ];
  assert.equal(looksLikeCollectionName(volumes), true);
  // 两条异名同书（书名不同）不应被当成选集
  assert.equal(
    looksLikeCollectionName([
      { title: '活尸之死' },
      { title: '生尸之死' },
    ]),
    false,
  );
});

test('判重规则：繁简必须归一到同一个键（否则繁体条目会被重复收录）', () => {
  // 回归测试：`dup-rules.mjs` 原本自己维护一份只有五十几对的手写繁简表，
  // 覆盖不到「煙」「貓」「蹤」。于是《煙、土或食物》与库里的《烟、土或食物》
  // 归一结果不同，`check-new` 报「库中没有」，重复条目进了库，最后靠判重闸门兜住。
  // 现在对照表复用 refresh-ratings.mjs 的那一份，这里锁死关键字符。
  const pairs = [
    ['煙、土或食物', '烟、土或食物'],
    ['三毛貓追蹤', '三毛猫追踪'],
    ['惡靈公館', '恶灵公馆'],
    ['黑死館殺人事件', '黑死馆杀人事件'],
    ['腦髓地獄', '脑髓地狱'],
    ['續·日本殺人事件', '续·日本杀人事件'],
    ['魔術王事件', '魔术王事件'],
    ['哲學家的密室', '哲学家的密室'],
  ];
  for (const [trad, simp] of pairs) {
    assert.equal(normText(trad), normText(simp), `${trad} 与 ${simp} 归一结果不一致`);
  }
  // 归一后必须真的能用判重规则认出来
  assert.ok(
    duplicateReason(
      { title: '煙、土或食物', originalTitle: '煙か土か食い物', author: '舞城王太郎' },
      { title: '烟、土或食物', originalTitle: '煙か土か食い物', author: '舞城王太郎' },
    ),
    '繁体与简体书名应判为同一部作品',
  );
});

test('判重规则：题名里的分号也必须剥掉（否则同一册「双标题合卷」会被当成两册）', () => {
  // 回归测试（第 125 轮）：`NOISE` 里原本没有分号，于是库内写「闪光的手指**；**冰冷的手」、
  // 候选池写「闪光的手指 冰冷的手」，归一后一个带分号一个不带，**同一册书两边对不上**——
  // 「梅森探案」那 7 条双标题合卷因此在候选池里赖了三十多轮。
  const groups = [
    ['闪光的手指；冰冷的手', '闪光的手指 冰冷的手'],
    ['跛脚金丝雀；看门人的猫', '跛脚金丝雀 看门人的猫'],
    ['空盒疑案;怪钟谜案', '空盒疑案·怪钟谜案'],
  ];
  for (const [a, b] of groups) {
    assert.equal(normText(a), normText(b), `「${a}」与「${b}」归一结果不一致`);
  }
  assert.ok(
    duplicateReason(
      { title: '闪光的手指；冰冷的手', author: '厄尔·斯坦利·加德纳' },
      { title: '闪光的手指 冰冷的手', author: '加德纳' },
    ),
    '同一册书的分号写法差异应判为重复',
  );
});

test('looksLikeDifferentBook：通用短书名必须比作者（同书名不同作者不是同一本书）', () => {  // 回归测试：这条规则原本是「书名骨架完全相同就直接放行，连作者都不看」。
  // 对长而独特的书名没问题，对通用短书名必然出错——库里久生十兰的《魔都》
  // 因此吃到了村松梢风同名上海游记（原作 SHANGHAI）的评分 7.2 / 465 人。
  // 同类风险：《十字街》《黑色记事本》。
  assert.equal(
    looksLikeDifferentBook({ title: '魔都', author: '村松梢风' }, { title: '魔都', author: '久生十兰' }).reject,
    true,
    '同书名不同作者必须判为另一本书',
  );
  // 但不能误伤：作者写法差异、缺作者信息都要照常放行
  assert.equal(
    looksLikeDifferentBook({ title: '魔都', author: '[日] 久生十兰' }, { title: '魔都', author: '久生十兰' }).reject,
    false,
    '同一作者的不同写法不应判为另一本书',
  );
  assert.equal(
    looksLikeDifferentBook({ title: '魔都', author: '' }, { title: '魔都', author: '久生十兰' }).reject,
    false,
    '候选缺作者信息时无法证伪，应予放行',
  );
  assert.equal(
    looksLikeDifferentBook(
      { title: '明治开化安吾捕物帖', author: '坂口安吾' },
      { title: '明治开化安吾捕物帖', author: '坂口安吾' },
    ).reject,
    false,
    '同名同作者照常放行',
  );
});

test('normalizeSeedBook：alternateTitles 必须保留且幂等', () => {
  // 合并重复条目后，落选那一版的中文书名存在 alternateTitles 里。
  // normalizeSeedBook 是显式字段白名单，漏掉这一项就会被静默丢弃，
  // 于是用旧译名搜索的读者再也找不到这本书。
  const raw = {
    id: 'x-1',
    title: '球形的荒野',
    originalTitle: '球形の荒野',
    author: '松本清张',
    genre: '社会派',
    safeSummary: '一名记者受命追查一位战后下落不明的外交官，相关的人都刻意回避同一段时期。',
    tags: ['concealment'],
    ratings: {},
    alternateTitles: ['一个背叛日本的日本人', '  ', '一个背叛日本的日本人'],
  };
  const once = normalizeSeedBook(raw, null, 'test.json');
  assert.deepEqual(once.alternateTitles, ['一个背叛日本的日本人'], '空白项与重复项应被清掉');
  const twice = normalizeSeedBook(once, null, 'test.json');
  assert.deepEqual(twice.alternateTitles, once.alternateTitles, 'normalize 必须幂等');
  // 没写这个字段时应当是空数组而不是 undefined（否则前端要到处判空）
  assert.deepEqual(normalizeSeedBook({ ...raw, alternateTitles: undefined }, null, 'x.json').alternateTitles, []);
});

/* ------------------------------------------------------------------ */
/* 人工钉住的豆瓣条目（data/subject-pins.mjs）                          */
/* ------------------------------------------------------------------ */

test('钉住的豆瓣条目：id 必须在知识库里真实存在，且必须自带条目页出版年', async () => {
  const { SUBJECT_PINS, pinFor } = await import('../data/subject-pins.mjs');
  const booksDir = new URL('../data/books/', import.meta.url);
  const { readdirSync } = await import('node:fs');

  const known = new Map();
  for (const file of readdirSync(booksDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'))) {
    for (const b of JSON.parse(readFileSync(new URL(file, booksDir), 'utf8'))) known.set(b.id, b);
  }

  // 空表会让下面的循环一次都不执行，测试就成了空转——所以先钉死非空。
  const pinIds = Object.keys(SUBJECT_PINS);
  assert.ok(pinIds.length > 0, '钉住表不应为空；若确已全部不再需要，请连同本测试一起删除');

  for (const [bookId, pin] of Object.entries(SUBJECT_PINS)) {
    // 悬空的钉子是**静默失效**的：书被改名/删掉后钉住表不会报错，
    // 只会让那本书永远拿不到评分。所以这里硬性要求钉住的 id 在库中存在。
    assert.ok(known.has(bookId), `钉住的 ${bookId} 不在知识库里（书可能已改名或删除，钉子已悬空）`);
    assert.match(pin.subjectId, /^\d+$/, `${bookId} 的 subjectId 必须是纯数字条目号`);
    assert.ok(pin.note && pin.note.length >= 10, `${bookId} 必须写明凭什么确认是同一条目`);

    // editionYear 必须是**条目页上的**出版年，不能拿 firstPublished 回填。
    // 少了这个字段，抓取器会退回用 firstPublished，等于把整理者自己的记录
    // 当成豆瓣著录（自证而非取证）——《罪恶天使》首版 2012、条目页 2014 就是实例。
    assert.ok(
      pin.editionYear && /^\d{4}$/.test(String(pin.editionYear)),
      `${bookId} 必须显式写明条目页出版年 editionYear（四位年份），不得依赖 firstPublished 回填`
    );
  }

  assert.equal(pinFor('不存在的-id'), null, '没有钉子的书应返回 null');
  const first = Object.keys(SUBJECT_PINS)[0];
  assert.equal(pinFor(first).subjectId, SUBJECT_PINS[first].subjectId, 'pinFor 应原样返回钉住项');
});

/* ------------------------------------------------------------------ */
/* OPAC 熔断（scripts/lib/opac.mjs）                                    */
/* ------------------------------------------------------------------ */

test('OPAC 熔断：连续失败要能被计数并复位，成功则清零', async () => {
  const { get, opacHealth } = await import('../scripts/lib/opac.mjs');

  /**
   * 这条测试锁的是一个**真实事故**：`opac-author --all` 一次性打上千次请求，
   * 把 opac.yzlib.cn 打到整站拒连，豆瓣与馆藏两条外源一起废掉好几天。
   * 当时失败只是一路 `continue`，脚本持续加压；现在必须能计数并让调用方熔断。
   *
   * 只连本机一个**没人监听**的端口，不发任何外网请求（离线可跑）。
   */
  const DEAD = 'http://127.0.0.1:9/';

  opacHealth.reset();
  assert.equal(opacHealth.failures, 0, 'reset 后失败计数应为 0');

  await assert.rejects(() => get(DEAD, { retries: 1 }), '连不上的地址应当抛错');
  assert.equal(opacHealth.failures, 1, '一次失败后计数应为 1');

  await assert.rejects(() => get(DEAD, { retries: 1 }));
  assert.equal(opacHealth.failures, 2, '连续两次失败后计数应为 2');

  opacHealth.reset();
  assert.equal(opacHealth.failures, 0, 'reset 必须能把计数清零（否则熔断后无法恢复）');
});

/* ------------------------------------------------------------------ */
/* 年份字段拆分（firstPublished ＝ 原作年，editionYear ＝ 所引版本年）  */
/* ------------------------------------------------------------------ */

test('年份字段：normalizeSeedBook 保留 editionYear，且与 firstPublished 互不覆盖', () => {
  const raw = {
    id: 'y1',
    title: '某译本',
    author: '某作者',
    genre: '本格推理',
    country: '日本',
    safeSummary: '一句话简介。',
    tags: ['locked-room'],
    ratings: {},
    firstPublished: '', // 原作年查不到 → 允许留空
    editionYear: '2024', // 本库所引中译本的年
  };
  const b = normalizeSeedBook(raw, null, 'test.json');
  assert.equal(b.firstPublished, '', 'firstPublished 应当允许留空（原作年查不到时）');
  assert.equal(b.editionYear, '2024', 'editionYear 必须被保留——它在 seed.js 的字段白名单里');

  // 幂等
  assert.deepEqual(normalizeSeedBook(b, null, 'test.json').editionYear, '2024');
  // 没写这个字段时应当是空字符串而不是 undefined（否则前端要到处判空）
  assert.equal(normalizeSeedBook({ ...raw, editionYear: undefined }, null, 'x.json').editionYear, '');
});

test('年份字段：排序优先用原作年，缺失时退回版本年（不能因为留空就全排到末尾）', async () => {
  const { sortYear } = await import('../web/js/core/store.js');

  assert.equal(sortYear({ firstPublished: '1958', editionYear: '2010' }), 1958, '两栏都有时以原作年为准');
  assert.equal(sortYear({ firstPublished: '', editionYear: '2024' }), 2024, '原作年缺失时退回版本年');
  assert.equal(sortYear({ firstPublished: '1958', editionYear: '' }), 1958, '只有原作年时用它');
  assert.equal(sortYear({ firstPublished: '', editionYear: '' }), 9999, '两栏都空才排到末尾');
  assert.equal(sortYear({}), 9999, '字段整个缺失也不能抛错');

  // 带月份／多余文字的写法也要能取出四位年份（数据里确实有「2013-02」「2009年10月」这种）
  assert.equal(sortYear({ firstPublished: '2013-02' }), 2013);
  assert.equal(sortYear({ editionYear: '2009年10月' }), 2009);
});

/* ------------------------------------------------------------------ */
/* 封面处理的纯函数（scripts/lib/covers.mjs，第 166 轮）                */
/* ------------------------------------------------------------------ */

test('封面：10 位书号折算成 13 位（否则会误判成「不是同一版」而丢掉一本有封面的书）', () => {
  // 《木桶之谜》馆藏著录写的是 10 位号，豆瓣条目页写的是 13 位号——是同一个书号
  assert.equal(toIsbn13('7501435642'), '9787501435647');
  assert.equal(toIsbn13('7-80689-195-1'), '9787806891957');
  // 13 位的原样返回（只做归一，不做校验位校验）
  assert.equal(toIsbn13('9787501435647'), '9787501435647');
  // 位数不对的原样返回，交给调用方判断
  assert.equal(toIsbn13('123'), '123');
  assert.equal(toIsbn13(''), '');
});

test('封面：从 verification.source 里抠 ISBN，只认 10／13 位且去重', () => {
  const book = {
    verification: {
      source:
        '书目取自**上海图书馆 OPAC**：绫辻行人著，珠海出版社 2004，ISBN 7-80689-195-1，' +
        '丛编「(日)绫辻行人推理小说集」；2011 年另有新版 ISBN 978-7-5453-0506-7。',
    },
  };
  assert.deepEqual(isbnsOf(book), ['7806891951', '9787545305067']);
  // 同一本书里两处都写了同一个号，只留一条
  assert.deepEqual(isbnsOf({ verification: { source: 'ISBN 978-7-02-018646-4（另见 ISBN 9787020186464）' } }), [
    '9787020186464',
  ]);
  // 没有著录 / 没有 ISBN 的，返回空数组（而不是抛错）
  assert.deepEqual(isbnsOf({}), []);
  assert.deepEqual(isbnsOf({ verification: { source: '馆藏未给书号' } }), []);
});

test('封面：题名褪层（豆瓣的 suggest 是题名建议，不是全文检索）', () => {
  assert.deepEqual(titleQueries('水族馆之谜'), ['水族馆之谜']);
  // 副题褪掉后仍保留全名
  assert.ok(titleQueries('推理者的游戏：第一届华文推理大奖赛典藏集.上卷').includes('推理者的游戏'));
  // 最多三种写法，且不产生空串
  for (const q of titleQueries('a：b（c）')) assert.ok(q.trim().length >= 2);
  assert.ok(titleQueries('').length <= 1);
});

test('封面：识别豆瓣自己的「暂无封面」默认图', () => {
  assert.equal(isDefaultPic('https://img1.doubanio.com/tic/pics/book-default-lpic.gif'), true);
  assert.equal(isDefaultPic('https://img9.doubanio.com/view/subject/s/public/s9102105.jpg'), false);
  assert.equal(isDefaultPic(''), false);
});

test('封面：从条目页取主图与 info 字段', () => {
  const sample = `
    <div id="mainpic">
      <a href="https://img9.doubanio.com/view/subject/l/public/s27284260.jpg">
        <img src="https://img9.doubanio.com/view/subject/s/public/s27284260.jpg" title="点击看大图" rel="v:photo">
      </a>
    </div>
    <div id="info">
      <span><span class="pl">出版社:</span> 新星出版社</span><br>
      <span><span class="pl">出版年:</span> 2013-1</span><br>
      <span><span class="pl">ISBN:</span> 9787513309776</span><br>
    </div>`;
  assert.equal(parseMainPic(sample), 'https://img9.doubanio.com/view/subject/s/public/s27284260.jpg');
  const info = parseInfoLite(sample);
  assert.equal(info.publisher, '新星出版社');
  assert.equal(info.year, '2013-1');
  assert.equal(info.isbn, '9787513309776');
});

test('封面：图片宽高解析（位图才算图片，SVG／HTML 一律不算）', () => {
  // 占位图是 SVG：格式识别为 unknown，抓取端只接受 jpeg／webp，所以它进不了封面台账
  assert.equal(imageSize(readFileSync('web/covers/_placeholder.svg')).format, 'unknown');

  const jpegHead = Buffer.alloc(64);
  jpegHead.writeUInt16BE(0xffd8, 0); // SOI
  jpegHead.writeUInt16BE(0xffc0, 2); // SOF0
  jpegHead.writeUInt16BE(11, 4); // 段长
  jpegHead.writeUInt8(8, 6); // 精度
  jpegHead.writeUInt16BE(400, 7); // 高
  jpegHead.writeUInt16BE(270, 9); // 宽
  const j = imageSize(jpegHead);
  assert.deepEqual({ format: j.format, width: j.width, height: j.height }, { format: 'jpeg', width: 270, height: 400 });

  // 随便一段字节不能被当成图片（防止把错误页存成封面）
  assert.equal(imageSize(Buffer.from('<!DOCTYPE html><html>404</html>')).format, 'unknown');
  assert.equal(imageSize(null).format, '');
});

/* ------------------------------------------------------------------ */
/* 版本择优（第 168 轮：用户要求「选更新版本的封面，而不是用老的」）    */
/* ------------------------------------------------------------------ */

test('版本择优：优先取与所收版本同年的一条，其次才是最新（且不认异体字题名）', () => {
  const book = { title: '狱门岛', author: '横沟正史', editionYear: '2021' };
  const cands = [
    { id: '1', title: '狱门岛', year: '2012', author_name: '横沟正史', pic: 'a.jpg' },
    { id: '2', title: '狱门岛', year: '2021', author_name: '横沟正史', pic: 'b.jpg' },
    { id: '3', title: '狱门岛', year: '2024', author_name: '横沟正史', pic: 'c.jpg' },
  ];
  assert.deepEqual(pickNewestEdition(book, cands), { cand: cands[1], how: 'edition-year+title' });

  // 没有同年的一条 → 取最新（2024）
  assert.deepEqual(pickNewestEdition({ ...book, editionYear: '1999' }, cands), { cand: cands[2], how: 'newest+title' });

  // 台版《獄门島》繁简不同字：归一后与库内题名不等，**不能因为「年份更新」被选中**
  const withTrad = [...cands, { id: '4', title: '獄门島', year: '2026', author_name: '橫溝正史', pic: 'd.jpg' }];
  const r = pickNewestEdition({ ...book, editionYear: '1999' }, withTrad);
  assert.equal(r.cand.id, '3', '繁体版不该顶掉简体版');

  // 作者对不上的同名书也要排除（《狗之死》／《豺狗之死》那类陷阱）
  const wrongAuthor = [{ id: '9', title: '狱门岛', year: '2030', author_name: '别人', pic: 'x.jpg' }];
  assert.deepEqual(pickNewestEdition({ ...book, editionYear: '' }, wrongAuthor), { cand: null, how: '' });

  // 没有可用候选时返回空，不抛错
  assert.deepEqual(pickNewestEdition(book, []), { cand: null, how: '' });
});

test('版本择优：works 页解析（同一部作品的全部版本，含封面与出版年）', () => {
  const html = `
    <h1>狱门岛 全部版本(12)</h1>
    <div class="bkses clearfix">
      <div class="bkimg"><a href="https://book.douban.com/subject/38240380/">
        <img src="https://img3.doubanio.com/view/subject/s/public/s35411750.jpg"/></a></div>
      <div class="bkdesc"><a class="pl2" href="https://book.douban.com/subject/38240380/"> 獄门島 </a><br/>
        <div><span class="pl"> 出版社: </span> 獨步文化<br/><span class="pl"> 出版年: </span> 2026-2-26<br/></div>
      </div>
    </div>
    <div class="bkses clearfix">
      <div class="bkimg"><a href="https://book.douban.com/subject/11614712/">
        <img src="https://img3.doubanio.com/view/subject/s/public/s11194369.jpg"/></a></div>
      <div class="bkdesc"><a class="pl2" href="https://book.douban.com/subject/11614712/"> 狱门岛 </a><br/>
        <div><span class="pl"> 译者: </span> 王丽丽<br/><span class="pl"> 出版社: </span> 南海出版公司<br/><span class="pl"> 出版年: </span> 2021-5<br/></div>
      </div>
    </div>`;
  const eds = parseWorksEditions(html);
  assert.equal(eds.length, 2);
  assert.deepEqual(eds[0], {
    subjectId: '38240380',
    title: '獄门島',
    year: '2026-2-26',
    publisher: '獨步文化',
    translator: '',
    pic: 'https://img3.doubanio.com/view/subject/s/public/s35411750.jpg',
  });
  assert.equal(eds[1].year, '2021-5');
  assert.equal(eds[1].translator, '王丽丽');
  assert.equal(yearOf(eds[1].year), '2021');

  // 条目页里 works 链接的抽取
  assert.equal(parseWorksLink('<a href="https://book.douban.com/works/1014262">全部12</a>'), '1014262');
  assert.equal(parseWorksLink('<div>没有链接</div>'), '');
  assert.deepEqual(parseWorksEditions(''), []);
});

test('封面：识别豆瓣的限流拦截页（不能把它当成「这部作品没有其他版本」）', () => {
  // 实测的拦截页形态：3KB 上下、<title>豆瓣</title>、没有正文
  const block = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>豆瓣</title></head><body>${'x'.repeat(2900)}</body></html>`;
  assert.equal(isBlockPage(block, 200), true);
  assert.equal(isBlockPage('<html><body>403 Forbidden</body></html>', 403), true);
  assert.equal(isBlockPage('', 200), false, '空响应不判定为拦截（那是网络问题，另有熔断）');

  // 正常条目页 / works 页不能被误判
  const normal = `<html><body>${'y'.repeat(9000)}<div id="mainpic"><img src="a.jpg"></div></body></html>`;
  assert.equal(isBlockPage(normal, 200), false);
  const works = `<html><body><div class="bkses clearfix">…</div>${'z'.repeat(9000)}</body></html>`;
  assert.equal(isBlockPage(works, 200), false);
});

/* ------------------------------------------------------------------ */
/* 封面判据码（第 177 轮：把「版本一览」两轮的判据说成弱链接的回归测试）  */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 国别与作者聚合（第 189 轮：按国别浏览 + 搜作者看卷数）                 */
/* ------------------------------------------------------------------ */

test('国别聚合：国别归大区，未知国别落「其他」', () => {
  assert.equal(regionOf('日本'), '东亚');
  assert.equal(regionOf('中国'), '东亚');
  assert.equal(regionOf('英国'), '欧洲');
  assert.equal(regionOf('冰岛'), '欧洲');
  assert.equal(regionOf('美国'), '北美');
  assert.equal(regionOf('阿根廷'), '拉美');
  assert.equal(regionOf('澳大利亚'), '大洋洲');
  assert.equal(regionOf('南非'), '其他', '没登记的国别不能抛，也不该被塞进别的大区');
  assert.equal(regionOf(''), '其他');
  assert.equal(regionOf(undefined), '其他');
});

test('国别聚合：每个国别的藏书量、代表作者、最高分三本', () => {
  const books = [
    { id: 'a1', title: '甲', author: 'A', country: '日本', ratings: { douban: { score: 9.1 } } },
    { id: 'a2', title: '乙', author: 'A', country: '日本', ratings: { douban: { score: 8.2 } } },
    { id: 'a3', title: '丙', author: 'B', country: '日本', ratings: { douban: { score: 7.5 } } },
    { id: 'b1', title: '丁', author: 'C', country: '英国', ratings: { douban: { score: 8.8 } } },
    { id: 'b2', title: '戊', author: 'D', country: '英国' }, // 没有评分 → 不进 best
    { id: 'x1', title: '己', author: 'E', country: '' }, // 没有国别 → 不进任何国别
  ];
  const stats = countryStats(books);
  assert.deepEqual(stats.map((s) => s.country), ['日本', '英国'], '按藏书量降序');
  const jp = stats.find((s) => s.country === '日本');
  assert.equal(jp.count, 3);
  assert.deepEqual(jp.authors[0], { name: 'A', count: 2 }, '代表作者按该国藏书量排');
  assert.deepEqual(jp.best.map((b) => b.id), ['a1', 'a2', 'a3'], '最高分在前，且只收有评分的');
  const uk = stats.find((s) => s.country === '英国');
  assert.deepEqual(uk.best.map((b) => b.id), ['b1'], '没有评分的书不冒充「最高分」');
  assert.equal(countryStats([]).length, 0);
});

test('作者聚合：搜作者能看到他有几卷（合著按每位署名作者各计一次）', () => {
  const books = [
    { id: 'a', title: '一', author: '东野圭吾', country: '日本', ratings: { douban: { score: 8.0 } } },
    { id: 'b', title: '二', author: '东野圭吾', country: '日本', ratings: { douban: { score: 9.2 } } },
    { id: 'c', title: '三', authors: ['东野圭吾', '另一位'], country: '日本', ratings: { douban: { score: 7.0 } } },
    { id: 'd', title: '四', author: '阿加莎·克里斯蒂', country: '英国' },
  ];
  const stats = authorStats(books);
  const higashino = stats.find((s) => s.name === '东野圭吾');
  assert.equal(higashino.count, 3, '合著也算在他头上（与全站统计口径一致）');
  assert.equal(higashino.country, '日本');
  assert.equal(higashino.topScore, 9.2, '最高分取他自己的最好成绩');
  assert.equal(higashino.best.id, 'b');
  const christie = stats.find((s) => s.name === '阿加莎·克里斯蒂');
  assert.equal(christie.topScore, null, '没有评分时是 null，不是 0');
  assert.equal(stats[0].name, '东野圭吾', '默认按卷数降序');
  // 「另一位」也要能被搜到
  assert.ok(stats.some((s) => s.name === '另一位'));
});

test('作者聚合：搜索按姓名包含匹配，也能按国别搜', () => {
  const list = authorStats([
    { id: 'a', title: '一', author: '东野圭吾', country: '日本' },
    { id: 'b', title: '二', author: '阿加莎·克里斯蒂', country: '英国' },
    { id: 'c', title: '三', author: '江户川乱步', country: '日本' },
  ]);
  assert.equal(filterAuthors(list, '').length, 3, '空关键词返回全部');
  assert.deepEqual(filterAuthors(list, '东野').map((a) => a.name), ['东野圭吾']);
  assert.equal(filterAuthors(list, '日本').length, 2, '按国别也能搜');
  assert.equal(filterAuthors(list, '不存在的人').length, 0);
});

/* ------------------------------------------------------------------ */
/* 返回列表不丢位置（第 187 轮：用户反馈「看完返回就回到最上面」）        */
/* ------------------------------------------------------------------ */

test('滚动位置记忆：hash 归一化成记忆键', () => {
  assert.equal(scrollKey('#/library'), '#/library');
  assert.equal(scrollKey('#/library/'), '#/library', '尾部斜杠不该算成另一页');
  assert.equal(scrollKey('#/library?tag=locked-room'), '#/library?tag=locked-room', '带筛选参数的是另一条列表');
  assert.equal(scrollKey('#/'), '#/');
  assert.equal(scrollKey(''), '#/');
});

test('滚动位置记忆：页码按「筛选＋排序」分桶（换了筛选就该从第一页看起）', () => {
  const base = { q: '', cat: '', tag: '', genre: '', origin: '', country: '', sort: '' };
  assert.equal(listStateKey(base), listStateKey({ ...base }), '同样的参数 → 同一个桶');
  assert.notEqual(listStateKey(base), listStateKey({ ...base, q: '密室' }));
  assert.notEqual(listStateKey(base), listStateKey({ ...base, sort: 'year' }));
  assert.notEqual(listStateKey(base), listStateKey({ ...base, tag: 'locked-room' }));
  assert.notEqual(listStateKey(base), listStateKey({ ...base, country: '日本' }), '换了国别也是另一条列表');
  assert.equal(listStateKey(undefined), listStateKey({}), '没参数也要能算，不能抛');
});

test('滚动位置记忆：什么时候才该把位置还回去', () => {
  const saved = 1200;
  // 浏览器后退／前进 → 恢复
  assert.equal(
    shouldRestoreScroll({ prevView: 'book', prevKey: '#/book/a', nextView: 'library', nextKey: '#/library', isPop: true, saved }),
    true,
  );
  // 从档案页返回列表（书页上的「返回」是新的一次导航）→ 恢复
  assert.equal(
    shouldRestoreScroll({ prevView: 'book', prevKey: '#/book/a', nextView: 'library', nextKey: '#/library', isPop: false, saved }),
    true,
  );
  // 从别的页面主动点顶部导航进知识库 → 从头看
  assert.equal(
    shouldRestoreScroll({ prevView: 'tags', prevKey: '#/tags', nextView: 'library', nextKey: '#/library', isPop: false, saved }),
    false,
  );
  // 同一页重绘（改筛选等）→ 交给 keepScroll，不在这里抢
  assert.equal(
    shouldRestoreScroll({ prevView: 'library', prevKey: '#/library', nextView: 'library', nextKey: '#/library', isPop: false, saved }),
    false,
  );
  // 没记过位置 → 不恢复（而不是回到 0 以外的什么值）
  assert.equal(shouldRestoreScroll({ prevView: 'book', nextView: 'library', nextKey: '#/library', isPop: true, saved: null }), false);
  assert.equal(shouldRestoreScroll({ nextKey: '#/library', isPop: true, saved: Number.NaN }), false);
});

/* ------------------------------------------------------------------ */
/* 主图该是哪一版（第 180 轮：外文版顶掉中文版的自查与修正）             */
/* ------------------------------------------------------------------ */

test('封面版本挑选：挑主图的排序 —— 题名一致且文字相同的最前，外文版最后（第 181 轮的根因修复）', () => {
  const found = [
    { subjectId: 'th', title: 'ฆาตกรรมจักรราศีเลือด', year: '2026-6-16' }, // 泰文版（最新）
    { subjectId: 'kr', title: '인사이트 밀', year: '2022-9-30' }, // 韩文版
    { subjectId: 'cn', title: '占星术杀人魔法', year: '2013-8' }, // 简体（题名一致）
    { subjectId: 'tw', title: '占星術殺人魔法', year: '2019-5' }, // 繁体（题名一致、文字不同）
  ];
  const ordered = orderEditionsForPrimary(found, '占星术杀人魔法');
  assert.deepEqual(
    ordered.map((e) => e.subjectId),
    ['cn', 'tw', 'th', 'kr'],
    '简体优先于繁体，中文版优先于外文版；同类内按年份降序',
  );

  // 台版书（库内题名是繁体）→ 先挑繁体版
  const tw2 = orderEditionsForPrimary(
    [
      { subjectId: 'cn', title: '占星术杀人魔法', year: '2013-8' },
      { subjectId: 'tw', title: '占星術殺人魔法', year: '2019-5' },
    ],
    '占星術殺人魔法',
  );
  assert.equal(tw2[0].subjectId, 'tw', '书是台版就先挑繁体版（不能反向顶掉）');

  // 版本一览里根本没有中文版时，仍要给出外文版（总比没有强），且按年份降序
  const onlyForeign = orderEditionsForPrimary(
    [
      { subjectId: 'en', title: 'The Tokyo Zodiac Murders', year: '2015-1' },
      { subjectId: 'th', title: 'ฆาตกรรมจักรราศีเลือด', year: '2026-6-16' },
    ],
    '占星术杀人魔法',
  );
  assert.deepEqual(onlyForeign.map((e) => e.subjectId), ['th', 'en'], '只有外文版时按年份降序');
  assert.equal(orderEditionsForPrimary([], '占星术杀人魔法').length, 0);
});

test('封面版本挑选：题名是否「正面吻合」（繁简／数字／虚词都归一）', () => {
  // 同一题名的不同写法都算吻合
  assert.equal(sameTitleEdition('点与线', '點與線'), true, '繁体写法归一后是同一题名');
  assert.equal(sameTitleEdition('砂之器', '砂器'), true, '虚词增减不算换书');
  assert.equal(sameTitleEdition('心理罪·画像', '心理罪：画像'), true, '分隔符不同不算换书');
  assert.equal(sameTitleEdition('19年间谋杀小叙', '十九年间谋杀小叙'), true, '数字写法不同不算换书');
  assert.equal(sameTitleEdition('本阵杀人事件', '本陣殺人事件'), true);

  // 外文版／另一部作品不算吻合（这正是「泰文封面顶掉中文版」那个 bug 的判据）
  assert.equal(sameTitleEdition('占星术杀人魔法', 'ฆาตกรรมจักรราศีเลือด'), false);
  assert.equal(sameTitleEdition('点与线', 'Tokyo Express'), false);
  assert.equal(sameTitleEdition('坏小孩', 'Плохие дети'), false);
  assert.equal(sameTitleEdition('枯草之根', '桃源亭事件'), false, '同作者的另一部作品不算吻合');
});

test('封面版本挑选：繁体题名的判据（不能用「汉字有没有大小写」去判）', () => {
  assert.equal(isTraditionalTitle('點與線'), true);
  assert.equal(isTraditionalTitle('本陣殺人事件'), true);
  assert.equal(isTraditionalTitle('点与线'), false);
  assert.equal(isTraditionalTitle('Tokyo Express'), false, '外文题名不是繁体');
  assert.equal(isTraditionalTitle(''), false);
});

test('封面版本挑选：只有明显更大才换图（不为几个像素折腾一次提交）', () => {
  const small = { width: 98, height: 140 };
  assert.equal(preferLargerImage(small, { width: 270, height: 358 }), true, '98 → 270 是明显的升级');
  assert.equal(preferLargerImage(small, { width: 200, height: 290 }), true);
  assert.equal(preferLargerImage(small, { width: 110, height: 158 }), false, '只大一点点不值得换');
  assert.equal(preferLargerImage(small, { width: 150, height: 214 }), false, '150 没到 200 的下限');
  assert.equal(preferLargerImage({ width: 260, height: 380 }, { width: 270, height: 390 }), false);
  assert.equal(preferLargerImage(small, { width: 300, height: 60 }), false, '横图不换（高度不能变小）');
  assert.equal(preferLargerImage(small, { width: 0, height: 0 }), false, '拿不到尺寸就不换');
});

test('封面判据码：台账判据名 → 前端一个字母，且不把强判据说成弱链接', () => {  assert.equal(coverCodeOf({ matched: 'subject-id' }), 'S');
  assert.equal(coverCodeOf({ matched: 'isbn' }), 'I');
  assert.equal(coverCodeOf({ matched: 'shlib-isbn' }), 'B');
  assert.equal(coverCodeOf({ matched: 'subject-id-miss+prefix+author' }), 'A');

  // 版本一览那两轮：同年 → Y，否则（最新／库内版本年不详）→ N。
  // 回归点：这两个判据名原先不在表里，会被兜底成 W，全库 2485 部书因此把强判据显示成「弱链接」。
  assert.equal(coverCodeOf({ matched: 'editions+works', yearMatch: true }), 'Y');
  assert.equal(coverCodeOf({ matched: 'editions+works', yearMatch: false }), 'N');
  assert.equal(coverCodeOf({ matched: 'editions+works', yearMatch: null }), 'N');
  assert.equal(coverCodeOf({ matched: 'editions+weread', yearMatch: true }), 'Y');
  assert.equal(coverCodeOf({ matched: 'editions+weread', yearMatch: false }), 'N');

  // 认不出来的一律按最弱的 W，不假装更强
  assert.equal(coverCodeOf({ matched: 'something-new' }), 'W');
  assert.equal(coverCodeOf({}), 'W');
  assert.equal(coverCodeOf(null), 'W');

  // 映射表里的代码必须是前端认得的单字母（前端 how 表按这些键取值）
  const allowed = new Set(['S', 'I', 'B', 'P', 'T', 'Y', 'N', 'R', 'A', 'W']);
  for (const [name, code] of Object.entries(COVER_MATCH_CODE)) {
    assert.ok(allowed.has(code), `判据 ${name} 映射成了未知代码 ${code}`);
  }
});

test('封面判据码：与生成出的前端清单逐条一致（清单不许自己说另一套）', async () => {
  const manifest = await import('../web/js/core/covers.js');
  const index = JSON.parse(readFileSync(new URL('../data/covers.json', import.meta.url), 'utf8'));
  let checked = 0;
  const wrong = [];
  for (const [id, rec] of Object.entries(index.records || {})) {
    if (!rec.file || !manifest.hasCover(id)) continue;
    const credit = manifest.coverCredit(id);
    if (!credit) continue;
    checked += 1;
    if (credit.code !== coverCodeOf(rec)) wrong.push(`${id}：清单 ${credit.code} ／ 台账 ${rec.matched}`);
  }
  assert.ok(checked > 3000, `应当覆盖全库有封面的书，实际只查了 ${checked} 条`);
  assert.deepEqual(wrong, [], '前端清单的判据码必须由 coverCodeOf() 生成（跑 node scripts/gen-cover-manifest.mjs）');
});

/* ------------------------------------------------------------------ */
/* 封面版本判重（第 171 轮：用户反馈「两版的图其实一模一样」）           */
/* ------------------------------------------------------------------ */

test('封面判重：结构指纹与比较（纯函数部分不依赖 ffmpeg）', () => {
  // 16×16 灰度：左边亮右边暗 → 每一行都是「左 < 右」的梯度
  const grad = new Uint8Array(256);
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) grad[y * 16 + x] = 40 + x * 10;
  const gradHash = dhashFromGray(grad);
  assert.equal(gradHash.length, 15 * 16, 'dHash 是「每行相邻两像素比大小」，15×16 位');

  // 同一张图（哪怕整体变亮/变暗）梯度关系不变 → 结构差 0
  const brighter = Uint8Array.from(grad, (v) => Math.min(255, v + 40));
  assert.equal(dhashDistance(gradHash, dhashFromGray(brighter)), 0, '整体明暗变化不该被判成不同图');
  assert.ok(meanAbsDiff(grad, brighter) > 20, '灰度差却能看出差别——所以两个判据都要用');

  // 反过来的梯度（左暗右亮）→ 结构差 100%
  const flipped = new Uint8Array(256);
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) flipped[y * 16 + x] = 200 - x * 10;
  assert.equal(dhashDistance(gradHash, dhashFromGray(flipped)), 1);

  // isSameCover：没有指纹时不下结论（返回 null，绝不误删）
  assert.equal(isSameCover(null, null), null);
  assert.equal(compareFingerprints(null, null), null);
  const fpA = [{ gray: grad, hash: gradHash }];
  assert.equal(isSameCover(fpA, fpA), true);
  assert.equal(isSameCover(fpA, [{ gray: flipped, hash: dhashFromGray(flipped) }]), false);
  assert.equal(isSameCover(fpA, [null]), null);
});

test('封面判重：真实图片指纹（本机有 ffmpeg 时才跑）', async (t) => {
  const { findFfmpeg, fingerprintsOfFile, compareFingerprints, isSameCover } = await import('./lib/image-fp.mjs');
  if (!findFfmpeg()) {
    t.skip('本机没有 ffmpeg，跳过真实图片指纹用例（判重脚本本身也会自动跳过）');
    return;
  }
  // 用测试夹具里那对「同一张图、裁切不同」的真实封面
  const dir = '_dd/pairs';
  const a = fingerprintsOfFile(`${dir}/honkaku-001-0-local.webp`);
  const b = fingerprintsOfFile(`${dir}/honkaku-001-1-remote.jpg`);
  if (!a || !b) {
    t.skip('测试夹具 _dd/pairs 不在（_dd/ 不进仓库），跳过');
    return;
  }
  const cmp = compareFingerprints(a, b);
  assert.ok(cmp.dhash < 0.15, `同一张图的裁切版结构差应当很小，实测 ${(cmp.dhash * 100).toFixed(1)}%`);
  assert.equal(isSameCover(a, b), true);
  // 不同封面（同一部作品的两个不同版本）应当判为不同
  const c = fingerprintsOfFile(`${dir}/facet121-010-1-remote.jpg`);
  if (c) assert.equal(isSameCover(a, c), false);
});

/* ------------------------------------------------------------------ */
/* 微信读书通道（第 170 轮：豆瓣 HTML 被限流时的第二条封面通道）        */
/* ------------------------------------------------------------------ */

test('微信读书：检索回执解析（带出版社、译者与评分人数）', () => {
  const json = {
    books: [
      {
        bookInfo: {
          bookId: 3300024305,
          title: '占星术杀人魔法（全新修订版）',
          author: '[日]岛田庄司',
          translator: '吕灵芝',
          publisher: '新星出版社',
          cover: 'https://cdn.weread.qq.com/weread/cover/5/3300024305/s_3300024305.jpg',
          newRating: 766,
          newRatingCount: 4096,
        },
      },
      { bookInfo: { title: '没有 bookId 的条目' } },
    ],
  };
  const list = parseWereadSearch(json);
  assert.equal(list.length, 1, '缺 bookId 的条目要丢掉');
  assert.deepEqual(list[0], {
    bookId: '3300024305',
    title: '占星术杀人魔法（全新修订版）',
    author: '[日]岛田司司'.replace('司司', '庄司'),
    translator: '吕灵芝',
    publisher: '新星出版社',
    cover: 'https://cdn.weread.qq.com/weread/cover/5/3300024305/s_3300024305.jpg',
    rating: 766,
    ratingCount: 4096,
  });
  assert.deepEqual(parseWereadSearch(null), []);
});

test('微信读书：封面按档取图（s_ 缩略 → tN_ 大图）', () => {
  const u = 'https://cdn.weread.qq.com/weread/cover/5/3300024305/s_3300024305.jpg';
  assert.equal(wereadCoverAt(u, 't3'), 'https://cdn.weread.qq.com/weread/cover/5/3300024305/t3_3300024305.jpg');
  assert.equal(wereadCoverAt(u, 't9'), 'https://cdn.weread.qq.com/weread/cover/5/3300024305/t9_3300024305.jpg');
  // 已经是 tN_ 的地址要能再换档
  assert.equal(wereadCoverAt(wereadCoverAt(u, 't3'), 't5').includes('/t5_'), true);
  assert.equal(wereadCoverAt(''), '');
});

test('微信读书：挑版本要题名对得上、作者也得吻合', () => {
  const book = { title: '狱门岛', author: '横沟正史' };
  const list = [
    { bookId: '1', title: '狱门岛', author: '[日]横沟正史', publisher: '南海出版公司', cover: 'a.jpg', ratingCount: 100 },
    { bookId: '2', title: '金田一探案集03：狱门岛', author: '[日]横沟正史', publisher: '南海出版公司', cover: 'b.jpg', ratingCount: 50 },
    { bookId: '3', title: '狱门岛', author: '别人的书', publisher: '某某社', cover: 'c.jpg', ratingCount: 999 },
    { bookId: '4', title: '恶魔的彩球歌', author: '[日]横沟正史', publisher: '南海出版公司', cover: 'd.jpg', ratingCount: 80 },
  ];
  const picks = pickWereadEditions(book, list, { limit: 3 });
  assert.deepEqual(
    picks.map((p) => p.bookId),
    ['1', '2'],
    '题名完全一致的排前面；作者不符（3）与题名不沾边（4）都要排除',
  );
  // 库内题名带丛编前缀时，微信读书的短题名也要能认出来
  const picks2 = pickWereadEditions({ title: '金田一探案集03：狱门岛', author: '横沟正史' }, list, { limit: 3 });
  assert.ok(picks2.some((p) => p.bookId === '1'));
  assert.deepEqual(pickWereadEditions(book, [], { limit: 3 }), []);
});
