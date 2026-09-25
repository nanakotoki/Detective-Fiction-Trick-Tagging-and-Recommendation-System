#!/usr/bin/env node
/**
 * 出版年语义审计
 * ==============
 * 背景（2026-09 发现）：`firstPublished` 在库内**两种语义混用**——
 *   · 老条目填的是**原作首次出版年**（半七捕物帐 1917、一朵桔梗花 1980、黑色皮箱 1956、
 *     无人生还 1939、点与线 1958）；
 *   · 本项目近几轮（batch-93 起）填的是**所引中译本的出版年**（美女 2025、瓦斯灯 2023、
 *     白光 2012、柏林黄昏 2024）——因为豆瓣与馆藏给的「出版年」就是该版本的年。
 *
 * 这不是吹毛求疵：这个字段同时被
 *   · **当「首次出版」显示**（`views/book.js`、`core/report.js`），
 *   · **拿来做按年代排序**（`views/library.js`、`core/store.js`）。
 * 两种语义混在一起，「1900 年代」那一档里会混进 2025 年的书。
 *
 * 本脚本**只报告、不改数据**，因为正确的原作年目前取不到（豆瓣 403）。
 * 判据故意保守：只有当某条目的年份**晚于该作者的卒年**时才报——
 * 一位 1965 年去世的作家，不可能在 2002 年首次出版一部作品；
 * 那种年份一定是**版本年**被当成了出版年。
 *
 * 已知合理例外（不报）：**中文世界自行编选的合集**本来就没有「原作首次出版年」，
 * 例如《乱步侦探作品集 3》（2002）、《日本推理名作选·梦野久作（卷一）》、
 * 加德纳「梅森探案集」合订本——它们的题名里带「作品集／名作选／探案集／选集／全集」
 * 或卷次，按题名排除。
 *
 * 用法：node scripts/audit-year-semantics.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';

const DIR = 'data/books';

/**
 * 作者 → 卒年。**只收录我有把握的**；不确定的一律不列（宁少勿错）。
 * 判据是「年份晚于卒年」，所以卒年取整即可。
 */
const DEATH = {
  爱伦·坡: 1849,
  威尔基·柯林斯: 1889,
  夏目漱石: 1916,
  森鸥外: 1922,
  芥川龙之介: 1927,
  加斯顿·勒鲁: 1927,
  柯南·道尔: 1930,
  浜尾四郎: 1935,
  梦野久作: 1936,
  牧逸马: 1936,
  冈本绮堂: 1939,
  泉镜花: 1939,
  莫里斯·勒布朗: 1941,
  大阪圭吉: 1943,
  国枝史郎: 1943,
  甲贺三郎: 1945,
  小栗虫太郎: 1946,
  海野十三: 1949,
  山本禾太郎: 1951,
  坂口安吾: 1955,
  久生十兰: 1957,
  佐藤春夫: 1964,
  江户川乱步: 1965,
  谷崎润一郎: 1965,
  程小青: 1976,
  阿加莎·克里斯蒂: 1976,
  约翰·迪克森·卡尔: 1977,
  横沟正史: 1981,
  埃勒里·奎因: 1982,
  松本清张: 1992,
};

/** 中文世界自编的合集／丛书：本来就没有「原作首次出版年」，年份用版本年是合理的 */
const COLLECTION_RE = /作品集|名作选|探案集|选集|全集|文库|丛书|合订|卷[一二三四五六七八九十\d]|（[上中下]）|\([上中下]\)|第[一二三四五六七八九十\d]+卷/;

const suspects = [];
const collections = [];
let checked = 0;

for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  for (const b of JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))) {
    const death = DEATH[b.author];
    if (!death) continue;
    const y = parseInt(String(b.firstPublished || '').match(/\d{4}/)?.[0] ?? '', 10);
    if (!y) continue;
    checked += 1;
    if (y <= death) continue;
    const row = { file: f, id: b.id, title: b.title, author: b.author, year: y, death };
    if (COLLECTION_RE.test(b.title)) collections.push(row);
    else suspects.push(row);
  }
}

console.log('\n  出版年语义审计');
console.log('  ────────────────────────────────────────────');
console.log(`  可判定作者（有卒年）的条目：${checked} 部\n`);

if (!suspects.length) {
  console.log('  ✓ 没有「年份晚于作者卒年」且不属于合集的条目。\n');
} else {
  // 这条判据（年份晚于卒年）有一类**必然的假阳性**：作者死后才首次出版的书。
  // 它们不是「版本年误填」，而是本来就晚于卒年：
  //   · 遗作结集（克里斯蒂《马普尔小姐最后的案件》1979、《灯火阑珊》1997）；
  //   · 授权续写／小说化（Charles Osborne 把克里斯蒂的三部舞台剧改成小说，
  //     《黑咖啡》1998、《意外来客》1999、《蜘蛛网》2000 正是这些**成书**的首版年）。
  // 下面把已逐条人工复核、确认合法的条目单列出来，免得每轮都把它们当问题重报。
  const REVIEWED_OK = {
    'md55-006': '克里斯蒂遗作结集《马普尔小姐最后的案件》，1979 年为该结集首版年，晚于作者卒年（1976）属正常',
    'chr57-003': '克里斯蒂遗作结集《灯火阑珊》（While the Light Lasts），1997 年为首版年',
    'src112-002': '《黑咖啡》为 Charles Osborne 据克里斯蒂舞台剧改编的**小说化作品**，1998 年是成书首版年',
    'src112-001': '《意外来客》同为 Osborne 的小说化作品，1999 年是成书首版年',
    'series111-005': '《蜘蛛网》同为 Osborne 的小说化作品，2000 年是成书首版年',
  };
  const real = suspects.filter((r) => !REVIEWED_OK[r.id]);
  const reviewed = suspects.filter((r) => REVIEWED_OK[r.id]);
  console.log(`  ! ${real.length} 部的年份**晚于作者卒年**，几乎可以确定填的是「中译本版本年」而非「首次出版年」：`);
  for (const r of real) {
    console.log(`      ${String(r.year).padEnd(6)} ${r.author}（卒于 ${r.death}）  《${r.title}》  ${r.id}`);
  }
  console.log(
    '\n    ⚠️ 这些**不自动改**：正确的原作年目前取不到（豆瓣整站 403、馆藏拒连）。' +
      '\n       待外源恢复后按原作名逐条查证再改。详见 docs/collection-backlog.md 第十一节。\n'
  );
  if (reviewed.length) {
    console.log(`  ✓ 另有 ${reviewed.length} 条**已人工复核为合法**（遗作结集／授权小说化，本就晚于卒年）：`);
    for (const r of reviewed) console.log(`      ${String(r.year).padEnd(6)} 《${r.title}》  ${r.id} —— ${REVIEWED_OK[r.id]}`);
    console.log('');
  }
}

if (collections.length) {
  console.log(`  （另有 ${collections.length} 条年份晚于卒年、但题名属于**中文自编合集**，版本年即为合理值，不计入问题项）`);
}

/**
 * 更隐蔽的一种问题：**同一作者内部两种语义并存**。
 * 实例——冈本绮堂的《半七捕物帐》中文各卷里，4 卷填 1917（原作初出年）、
 * 7 卷填 2010／2024（中译本版本年）。单看每一条都不算错，
 * 但放在一起「按年代排序」就会把同一套书劈成两半。
 * 这种不一致**没法靠卒年判据发现**，必须按作者横向比。
 */
// 与上一段共用同一份「已复核合法」名单：遗作结集／授权小说化的年份本就晚于卒年，
// 不该再被算成「疑似版本年」而让作者看起来「两种语义并存」。
const REVIEWED_OK = {
  'md55-006': 1, 'chr57-003': 1, 'src112-002': 1, 'src112-001': 1, 'series111-005': 1,
};
const byAuthor = new Map();
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  for (const b of JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))) {
    if (!DEATH[b.author]) continue;
    if (REVIEWED_OK[b.id]) continue;
    // **中文自编合集要排除**：像《乱步侦探作品集 3》这种书本来就不存在「原作首次出版年」，
    // 版本年即为合理值。上一段的问题项也是这么排除的，这里必须同样处理，
    // 否则合集会把同一作者「染成」两种语义并存。
    if (COLLECTION_RE.test(b.title)) continue;
    const y = parseInt(String(b.firstPublished || '').match(/\d{4}/)?.[0] ?? '', 10);
    if (!y) continue;
    if (!byAuthor.has(b.author)) byAuthor.set(b.author, []);
    byAuthor.get(b.author).push({ title: b.title, year: y });
  }
}

const mixed = [];
for (const [author, list] of byAuthor) {
  const death = DEATH[author];
  const classic = list.filter((x) => x.year <= death).length; // 看着像原作年
  const edition = list.filter((x) => x.year > death).length; // 看着像版本年
  if (classic && edition) mixed.push({ author, death, classic, edition, list });
}

if (mixed.length) {
  console.log(`\n  ! ${mixed.length} 位作者**库内两种语义并存**（同一人的书里既有疑似原作年、又有疑似版本年）：`);
  for (const m of mixed) {
    console.log(`      ${m.author}（卒于 ${m.death}）：疑似原作年 ${m.classic} 条 / 疑似版本年 ${m.edition} 条`);
    for (const x of m.list) console.log(`         ${String(x.year).padEnd(6)} 《${x.title}》`);
  }
  console.log('      这类不一致会让「按年代排序」把同一套书劈成两半，须统一。\n');
}
