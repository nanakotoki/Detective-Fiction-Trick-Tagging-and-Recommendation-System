/**
 * 平台评分解析层
 * ==============
 * 把「平台上的一页 HTML」翻译成结构化评分数据。这里的函数**不做网络请求**，
 * 因此可以用固定的 HTML 片段做单元测试——抓取逻辑最容易腐烂的地方就是解析，
 * 把它隔离出来单独测试是保证长期可用的关键。
 *
 * 设计原则：
 *   1. 每个返回值都必须携带 sourceUrl 与 fetchedAt，做到可追溯。
 *   2. 解析失败一律返回 null，绝不猜测、绝不回退到"看起来合理"的默认值。
 *   3. 对页面结构的多种写法做容错（豆瓣改版过数次评分块的结构）。
 */

/** 抓取时间戳（ISO 8601，精确到日） */
export function stampNow(date = new Date()) {
  return date.toISOString();
}

/** 年月（用于 ratings.asOf 字段） */
export function stampMonth(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

/* ------------------------------------------------------------------ */
/* 通用工具                                                            */
/* ------------------------------------------------------------------ */

/** 剥离 HTML 标签与实体，得到纯文本 */
export function stripTags(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** HTML 实体解码（保留标签，只解实体，用于抽取属性值） */
export function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

/** 解析「170787人评价」这类计数文本 */
export function parseCount(text) {
  if (text === null || text === undefined) return null;
  const raw = String(text).replace(/[,\s，]/g, '');
  const match = raw.match(/(\d+(?:\.\d+)?)\s*(万|w|k)?/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2]?.toLowerCase();
  if (unit === '万' || unit === 'w') return Math.round(value * 10000);
  if (unit === 'k') return Math.round(value * 1000);
  return Math.round(value);
}

/* ------------------------------------------------------------------ */
/* 豆瓣                                                                */
/* ------------------------------------------------------------------ */

/**
 * 解析豆瓣 `book.douban.com/j/subject_suggest` 的 JSON 响应。
 * @param {string|object} payload
 * @returns {Array<{id:string, title:string, author:string, year:string, url:string}>}
 */
export function parseDoubanSuggest(payload) {
  let data = payload;
  if (typeof payload === 'string') {
    try {
      data = JSON.parse(payload);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(data)) return [];

  return data
    .filter((item) => item && item.id && item.title)
    .map((item) => ({
      id: String(item.id),
      title: decodeEntities(item.title),
      author: decodeEntities(item.author_name ?? ''),
      year: String(item.year ?? ''),
      url: `https://book.douban.com/subject/${item.id}/`,
    }));
}

/**
 * 从豆瓣图书详情页 HTML 中抽取评分与评价人数。
 *
 * 兼容的页面结构（豆瓣改版过多次）：
 *   <strong class="ll rating_num" property="v:average">9.0</strong>
 *   <span property="v:votes">170787</span>
 *   <a class="rating_people"><span>170787</span>人评价</a>
 *   <strong class="rating_num ">9.0</strong>
 *
 * @param {string} html
 * @param {{ subjectId?: string, sourceUrl?: string, fetchedAt?: string }} [meta]
 * @returns {{ score:number, count:number|null, subjectId:string|null, title?:string, sourceUrl:string|null, fetchedAt:string } | null}
 */
export function parseDoubanSubject(html, meta = {}) {
  const source = String(html ?? '');
  if (!source.trim()) return null;

  // 有效性判断基于**内容特征**而不是长度：
  // 真实的详情页必然带有评分块标记（rating_num / v:average / rating_people 之一）。
  // 用长度阈值判断会误伤精简页面，也会放过内容很长的错误页。
  const looksLikeSubjectPage = /rating_num|v:average|rating_people|property="v:votes"/.test(source);
  if (!looksLikeSubjectPage) return null;

  // 被反爬拦截或需要登录
  if (/检测到有异常请求|请稍后再试|sec\.douban\.com|登录豆瓣/.test(source) && !/rating_num/.test(source)) {
    return null;
  }

  // ---- 评分 ----
  let score = null;
  const scorePatterns = [
    /<strong[^>]*class="[^"]*rating_num[^"]*"[^>]*>\s*([\d.]+)\s*<\/strong>/i,
    /property="v:average"[^>]*>\s*([\d.]+)\s*</i,
    /<strong[^>]*property="v:average"[^>]*>\s*([\d.]+)\s*<\/strong>/i,
  ];
  for (const pattern of scorePatterns) {
    const match = source.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0 && value <= 10) {
        score = Number(value.toFixed(1));
        break;
      }
    }
  }
  if (score === null) return null;

  // ---- 评价人数 ----
  let count = null;
  const countPatterns = [
    /property="v:votes"[^>]*>\s*([\d,]+)\s*</i,
    /<a[^>]*class="[^"]*rating_people[^"]*"[^>]*>[\s\S]{0,120}?<span[^>]*>\s*([\d,]+)\s*<\/span>/i,
    /<span[^>]*>\s*([\d,]+)\s*<\/span>\s*人评价/,
    /([\d,]+)\s*人评价/,
    /([\d,]+)\s*人读过/,
  ];
  for (const pattern of countPatterns) {
    const match = source.match(pattern);
    if (match) {
      const value = parseCount(match[1]);
      if (value !== null && value >= 0) {
        count = value;
        break;
      }
    }
  }

  // ---- 书名（用于核对抓取到的版本是否正确）----
  const titleMatch = source.match(/<span[^>]*property="v:itemreviewed"[^>]*>([\s\S]*?)<\/span>/i);
  const title = titleMatch ? decodeEntities(stripTags(titleMatch[1])) : undefined;

  return {
    score,
    count,
    subjectId: meta.subjectId ?? null,
    title,
    sourceUrl: meta.sourceUrl ?? (meta.subjectId ? `https://book.douban.com/subject/${meta.subjectId}/` : null),
    fetchedAt: meta.fetchedAt ?? stampNow(),
  };
}

/**
 * 从豆瓣作品页（/works/xxx）抽取「其他版本」列表。
 * 用于在多个版本之间挑选评价人数最多的那个。
 * @param {string} html
 * @returns {Array<{subjectId:string, label:string, score:number|null, count:number|null, url:string}>}
 */
export function parseDoubanOtherEditions(html) {
  const source = String(html ?? '');
  const out = [];
  const blockRe = /<li[^>]*>[\s\S]{0,600}?href="https:\/\/book\.douban\.com\/subject\/(\d+)\/"[^>]*>([\s\S]{0,200}?)<\/a>[\s\S]{0,200}?<\/li>/gi;
  let match;
  while ((match = blockRe.exec(source)) !== null) {
    const subjectId = match[1];
    const label = decodeEntities(stripTags(match[2]));
    if (!label || out.some((e) => e.subjectId === subjectId)) continue;
    const segment = match[0];
    const scoreMatch = segment.match(/([\d.]+)\s*分/);
    const countMatch = segment.match(/([\d,]+)\s*人读过/);
    out.push({
      subjectId,
      label,
      score: scoreMatch ? Number(scoreMatch[1]) : null,
      count: countMatch ? parseCount(countMatch[1]) : null,
      url: `https://book.douban.com/subject/${subjectId}/`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 微信读书                                                            */
/* ------------------------------------------------------------------ */

/**
 * 从微信读书书籍页抽取推荐值。
 * 页面为前端渲染，静态 HTML 中通常拿不到，因此失败是常态，返回 null 即可。
 * @param {string} html
 * @param {{ sourceUrl?: string, fetchedAt?: string }} [meta]
 */
export function parseWereadBook(html, meta = {}) {
  const source = String(html ?? '');
  if (!source) return null;

  // 常见形态："recommendPercent":89.5 或 推荐值 89.5%
  const patterns = [/"recommendPercent"\s*:\s*([\d.]+)/i, /推荐值[\s\S]{0,40}?([\d.]+)\s*%/];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0 && value <= 100) {
        return {
          score: Number(value.toFixed(1)),
          count: null,
          sourceUrl: meta.sourceUrl ?? null,
          fetchedAt: meta.fetchedAt ?? stampNow(),
        };
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 校验                                                                */
/* ------------------------------------------------------------------ */

/** 各平台的合法分值与小数位 */
export const PLATFORM_RULES = {
  douban: { min: 0, max: 10, decimals: 1, unit: '分' },
  hupu: { min: 0, max: 10, decimals: 1, unit: '分' },
  goodreads: { min: 0, max: 5, decimals: 2, unit: '分' },
  weread: { min: 0, max: 100, decimals: 1, unit: '%' },
  zhihu: { min: 0, max: 100, decimals: 1, unit: '%' },
};

/**
 * 校验一条抓取结果是否可信。
 * @param {string} platform
 * @param {{ score:number|null, count:number|null, sourceUrl:string|null }} entry
 * @returns {{ ok:boolean, reasons:string[] }}
 */
export function validateRating(platform, entry) {
  const reasons = [];
  const rule = PLATFORM_RULES[platform];

  if (!rule) reasons.push(`未知平台：${platform}`);
  if (!entry || typeof entry !== 'object') return { ok: false, reasons: ['条目为空'] };

  if (!entry.sourceUrl) reasons.push('缺少 sourceUrl，无法追溯');

  if (entry.score === null || entry.score === undefined) {
    reasons.push('没有解析到评分');
  } else if (!Number.isFinite(entry.score)) {
    reasons.push(`评分不是数字：${String(entry.score)}`);
  } else if (rule) {
    if (entry.score < rule.min || entry.score > rule.max) {
      reasons.push(`评分 ${String(entry.score)} 超出 ${platform} 的取值区间 ${String(rule.min)}~${String(rule.max)}`);
    }
    const decimals = String(entry.score).split('.')[1]?.length ?? 0;
    if (decimals > rule.decimals) {
      reasons.push(`评分小数位 ${String(decimals)} 超过 ${platform} 的精度 ${String(rule.decimals)}`);
    }
  }

  if (entry.count !== null && entry.count !== undefined) {
    if (!Number.isInteger(entry.count) || entry.count < 0) reasons.push(`评价人数非法：${String(entry.count)}`);
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * 批量校验一份抓取结果集。
 * @param {Array<{ id:string, title:string, platform:string, score:number|null, count:number|null, sourceUrl:string|null }>} entries
 */
export function validateBatch(entries) {
  const failures = [];
  const byId = new Map();

  for (const entry of entries ?? []) {
    const result = validateRating(entry.platform, entry);
    if (!result.ok) {
      failures.push({ ...entry, reasons: result.reasons });
      continue;
    }
    if (!byId.has(entry.id)) byId.set(entry.id, []);
    byId.get(entry.id).push(entry);
  }

  // 交叉检查：同一本书不同平台的评分应处于各自量纲内（防串台）
  for (const [id, list] of byId) {
    const douban = list.find((e) => e.platform === 'douban');
    const goodreads = list.find((e) => e.platform === 'goodreads');
    if (douban && goodreads && douban.score < goodreads.score) {
      failures.push({
        id,
        title: list[0].title,
        platform: 'cross-check',
        reasons: [`豆瓣 ${String(douban.score)}/10 低于 Goodreads ${String(goodreads.score)}/5，疑似两个平台的数值被写反`],
      });
    }
  }

  return { valid: [...byId.values()].flat(), failures };
}
