/**
 * 目录学聚合：国别与作者（第 189 轮）
 * ================================
 * 用户要「按作者国别分类」，还特别提了两条：
 *   · 要一个**按国别的总览页**（每个国别一张卡片：多少部、代表作者是谁、最高分是哪几本）；
 *   · **不要国别 → 作者的两级下钻**，而要「**搜作者就能看到他有几卷**」。
 *
 * 于是这里放**纯聚合函数**（可单测、两个视图共用），视图只负责画：
 *   `regionOf()`      国别 → 大区（东亚／欧洲／北美／拉美／大洋洲／其他），让总览页能分组摊开；
 *   `countryStats()`  每个国别：部数、代表作者、最高分的几本；
 *   `authorStats()`   每位作者：部数、国别、最高分与代表作。
 *
 * 统计口径与全站一致：作者用 `authorListOf()`（合著与合集都算，见 core/seed.js），
 * 评分用豆瓣原始分（没有评分的书排在后面，不参与「最高分」）。
 */

import { authorListOf } from './seed.js';

/** 国别 → 大区。用于总览页分组；没收录的国别归到「其他」。 */
const REGIONS = [
  ['东亚', ['日本', '中国', '韩国', '朝鲜', '中国台湾', '中国香港']],
  ['欧洲', ['英国', '法国', '德国', '瑞典', '荷兰', '挪威', '比利时', '冰岛', '西班牙', '意大利', '俄罗斯', '苏联', '瑞士', '丹麦', '爱尔兰', '捷克', '波兰', '葡萄牙', '奥地利', '芬兰', '希腊', '匈牙利']],
  ['北美', ['美国', '加拿大', '墨西哥']],
  ['拉美', ['阿根廷', '智利', '巴西', '哥伦比亚', '秘鲁', '乌拉圭']],
  ['大洋洲', ['澳大利亚', '新西兰']],
];

const REGION_OF = new Map();
for (const [region, list] of REGIONS) for (const country of list) REGION_OF.set(country, region);

export const REGION_ORDER = ['东亚', '欧洲', '北美', '拉美', '大洋洲', '其他'];
export const KNOWN_REGIONS = REGIONS.map(([name]) => name);

export function regionOf(country) {
  return REGION_OF.get(String(country ?? '').trim()) ?? '其他';
}

const scoreOf = (book) => {
  const score = book?.ratings?.douban?.score;
  return typeof score === 'number' ? score : null;
};
const countryOf = (book) => String(book?.country ?? '').trim();

/**
 * 每个国别的家底。
 * @returns {Array<{country:string, count:number, region:string, authors:Array<{name:string,count:number}>, best:Array<object>}>}
 */
export function countryStats(books = []) {
  const map = new Map();
  for (const book of books) {
    const country = countryOf(book);
    if (!country) continue;
    if (!map.has(country)) map.set(country, { country, region: regionOf(country), count: 0, authors: new Map(), best: [] });
    const entry = map.get(country);
    entry.count += 1;
    for (const name of authorListOf(book)) entry.authors.set(name, (entry.authors.get(name) ?? 0) + 1);
    entry.best.push(book);
  }
  return [...map.values()]
    .map((entry) => ({
      country: entry.country,
      region: entry.region,
      count: entry.count,
      authors: [...entry.authors.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh')),
      best: entry.best
        .filter((b) => scoreOf(b) !== null)
        .sort((a, b) => scoreOf(b) - scoreOf(a))
        .slice(0, 3),
    }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country, 'zh'));
}

/**
 * 每位作者的家底（「搜作者就能看到他有几卷」）。
 * @returns {Array<{name:string, count:number, country:string, best:object|null, topScore:number|null}>}
 */
export function authorStats(books = []) {
  const map = new Map();
  for (const book of books) {
    for (const name of authorListOf(book)) {
      if (!map.has(name)) map.set(name, { name, count: 0, countries: new Map(), best: null, topScore: null });
      const entry = map.get(name);
      entry.count += 1;
      const country = countryOf(book);
      if (country) entry.countries.set(country, (entry.countries.get(country) ?? 0) + 1);
      const score = scoreOf(book);
      if (score !== null && (entry.topScore === null || score > entry.topScore)) {
        entry.topScore = score;
        entry.best = book;
      }
    }
  }
  return [...map.values()]
    .map((entry) => ({
      name: entry.name,
      count: entry.count,
      // 一位作者原则上只有一个国别；合集里挂到多国时取出现最多的那个
      country: [...entry.countries.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
      best: entry.best,
      topScore: entry.topScore,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
}

/** 按关键词过滤作者（姓名包含即可），供作者页的搜索框用 */
export function filterAuthors(list = [], keyword = '') {
  const q = String(keyword ?? '').trim();
  if (!q) return list;
  const lower = q.toLowerCase();
  return list.filter((a) => a.name.toLowerCase().includes(lower) || String(a.country).includes(q));
}
