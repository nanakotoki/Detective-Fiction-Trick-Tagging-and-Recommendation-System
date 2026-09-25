/**
 * 敏感模式（Sensitive Mode）
 * ==========================
 * 设计目标：**让用户完全不用担心被剧透，连诡计标签都不显示。**
 *
 * 本系统的普通模式会展示「这本书有哪些类型的诡计」——对绝大多数读者无害，
 * 但对一类读者仍然是信息：他们连"这本书是密室"都不想知道，
 * 希望像逛书店一样只看书名、简介和评价。
 *
 * 实现方式：**呈现层闸门**（presentation gate），而不是删除数据。
 *   - 数据层始终保留完整标签（否则推荐算法就没法工作）
 *   - 所有渲染与导出都必须经过本模块的 gate*() 函数
 *   - 闸门开启时，它在结构上返回**空数组 / 中性文案**，
 *     因此"忘记隐藏某处"不会泄露，而是显示为空
 *
 * ⚠️ 新增任何展示诡计信息的界面时，请务必经过本模块，
 *    并同步更新 scripts/test-views.mjs 里的敏感模式断言。
 */

/** localStorage 键 */
const STORAGE_KEY = 'dftr:sensitive-mode';

/** 敏感模式下，推荐理由使用的中性表述 */
const NEUTRAL_REASONS = [
  '阅读体验与本书相近，氛围与节奏可作参照。',
  '整体气质与本书接近，可作为同类型的阅读延伸。',
  '感受层面与本书相似，适合喜欢本书的读者继续追读。',
];

let sensitive = false;
const listeners = new Set();

/* ------------------------------------------------------------------ */
/* 状态读写                                                            */
/* ------------------------------------------------------------------ */

/** 读取持久化的模式设置 */
export function loadSensitiveMode() {
  try {
    sensitive = globalThis.localStorage?.getItem(STORAGE_KEY) === '1';
  } catch {
    sensitive = false;
  }
  return sensitive;
}

/** 当前是否为敏感模式 */
export function isSensitive() {
  return sensitive;
}

/**
 * 设置敏感模式。
 * @param {boolean} value
 * @returns {boolean} 设置后的值
 */
export function setSensitive(value) {
  const next = Boolean(value);
  if (next === sensitive) return sensitive;
  sensitive = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    /* 隐私模式下忽略 */
  }
  applySensitiveAttributes();
  for (const listener of listeners) {
    try {
      listener(sensitive);
    } catch (error) {
      console.error('[sensitive] listener error', error);
    }
  }
  return sensitive;
}

/** 切换模式 */
export function toggleSensitive() {
  return setSensitive(!sensitive);
}

/** 订阅模式变化 */
export function onSensitiveChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 把当前模式写到 <html data-sensitive="...">。
 * CSS 依据该属性整体隐藏带 data-sensitive-hide 的元素——
 * 这样即使某个视图忘了走闸门，样式层仍是一道兜底。
 */
export function applySensitiveAttributes() {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  root.dataset.sensitive = sensitive ? 'on' : 'off';
}

/* ------------------------------------------------------------------ */
/* 闸门：以下是所有视图与导出必须经过的出口                            */
/* ------------------------------------------------------------------ */

/** 一组标签：敏感模式下返回空数组 */
export function gateTags(ids) {
  return sensitive ? [] : (ids ?? []);
}

/** 标签中文名列表：敏感模式下返回空数组 */
export function gateTagLabels(labels) {
  return sensitive ? [] : (labels ?? []);
}

/**
 * 推荐理由：敏感模式下换为不含诡计信息的中性文案。
 * @param {string} reason 普通模式的理由（通常含 `标签` 反引号）
 * @param {string} [seed] 用于挑选中性文案的种子（如书籍 id）
 */
export function gateReason(reason, seed = '') {
  if (!sensitive) return reason;
  const index = seed ? [...String(seed)].reduce((n, c) => n + c.codePointAt(0), 0) % NEUTRAL_REASONS.length : 0;
  return NEUTRAL_REASONS[index];
}

/**
 * 匹配明细里的类别信息：敏感模式下清空共享/缺失标签。
 * @param {object} detail scorePair() 的返回值
 */
export function gateMatchDetail(detail) {
  if (!sensitive || !detail) return detail;
  const cleared = (info) => (info ? { ...info, matched: [], missing: [], matchedCount: 0 } : info);
  return {
    ...detail,
    matched: [],
    missing: [],
    extra: [],
    trickMatched: [],
    narrativeMatched: [],
    sceneMatched: [],
    motiveMatched: [],
    themeMatched: [],
    schoolMatched: [],
    byCategory: Object.fromEntries(Object.entries(detail.byCategory ?? {}).map(([k, v]) => [k, cleared(v)])),
  };
}

/**
 * 阅读提示：敏感模式下**丢弃适合人群**。
 *
 * 原因：`suitableFor` 的描述本身常常含类型信息
 * （如「偏好封闭空间群像案件的读者」等于告诉你这本书是封闭空间）。
 * 而 `watchFor` / `warning` 是"该留意什么观察维度"，不含答案，予以保留。
 */
export function gateReadingTips(tips) {
  if (!tips) return tips;
  if (!sensitive) return tips;
  return { suitableFor: [], watchFor: tips.watchFor ?? [], warning: tips.warning ?? '' };
}

/** 通用：返回当前模式下的标签是否可见 */
export function tagsVisible() {
  return !sensitive;
}

/**
 * 生成敏感模式下的推荐结果。
 *
 * 排序仍然沿用算法结果（保证推荐质量不下降），
 * 但把一切能反推出诡计的字段清空，理由换成中性文案。
 *
 * @param {object} recResult recommend() 的返回值
 */
export function gateRecommendations(recResult) {
  if (!sensitive || !recResult) return recResult;
  return {
    ...recResult,
    recommendations: (recResult.recommendations ?? []).map((rec) => ({
      ...rec,
      reason: gateReason(rec.reason, rec.id ?? rec.book?.id),
      detail: gateMatchDetail(rec.detail),
    })),
    candidates: (recResult.candidates ?? []).map((rec) => ({
      ...rec,
      reason: gateReason(rec.reason, rec.id ?? rec.book?.id),
      detail: gateMatchDetail(rec.detail),
    })),
    // 排除原因里会写出「没有共享任何【诡计类】标签」这类信息，敏感模式下整体隐藏
    excluded: [],
  };
}

/**
 * 书籍对象：返回一份**可安全展示**的副本。
 *
 * 会移除 tags / school / customTags 等字段。用于把书传给渲染或序列化之前。
 * @param {object} book
 */
export function gateBook(book) {
  if (!sensitive || !book) return book;
  const { tags, schoolTags, customTags, ...rest } = book;
  void tags;
  void schoolTags;
  void customTags;
  return {
    ...rest,
    tags: [],
    schoolTags: [],
    customTags: [],
    readingTips: gateReadingTips(book.readingTips),
  };
}

/** 敏感模式下的入口提示文案 */
export function sensitiveBannerText() {
  return '敏感模式已开启：诡计标签、匹配依据与同类分析已全部隐藏，页面只保留书名、简介、评价与阅读提示，你可以放心浏览。';
}
