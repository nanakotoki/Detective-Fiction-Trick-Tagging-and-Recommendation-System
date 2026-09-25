/**
 * 把「库内作者的陌生书名」候选清洗成可送检的题名清单
 * ==================================================
 * `_dd/gap-candidates.tsv`（`dd:gaps` 的产物）里混着三类噪声，必须先剔掉，
 * 否则会把大量无效题名送进 OPAC，白白消耗对方服务器配额：
 *   ① **套装与合集**——「阿加莎克里斯蒂全集」「大侦探波洛全集」「作品精选集典藏纪念版」
 *   ② **营销残片**——当当标题被截断后剩下的「正版」「预售」之类
 *   ③ **已在库**——按归一后的书名（含 alternateTitles）比对
 *
 * 用法: node scripts/prep-gap-titles.mjs _dd/gap-candidates.tsv <输出清单>
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { leadTitle } from './lib/dd-title.mjs';

const inFile = process.argv[2];
const outFile = process.argv[3] || '_dd/gap-titles.txt';
if (!inFile) {
  console.error('用法: node scripts/prep-gap-titles.mjs <gap-candidates.tsv> [输出清单]');
  process.exit(1);
}

const norm = (s) =>
  String(s)
    .replace(/[（(【\[][^）)】\]]{0,20}[）)】\]]/g, '')
    .replace(/[\s:：·・、,，.。!！?？'"“”‘’—-]/g, '')
    .trim();

const DIR = 'data/books';
const have = new Set();
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  for (const b of JSON.parse(readFileSync(path.join(DIR, f), 'utf8'))) {
    if (b.title) have.add(norm(b.title));
    for (const t of b.alternateTitles ?? []) have.add(norm(t));
  }
}

/** 套装 / 合集 / 营销残片 */
const NOISE =
  /(全集|精选集|典藏|套装|盒装|礼盒|全\d+册|全套|第[一二三四五六七八九十\d]+辑|作品集|文集|丛书|系列全|盲盒|签名|亲签|藏书票|彩箔|拼图|书签|预售|正版|现货|包邮|新华书店|官方|限量|纪念版|刷边|特装|注音|绘本|漫画|英文版|双语)/;

/**
 * 去掉商家在书名上挂的「丛书编号」与「作者名」——它们让同一本书在清单里变成好几个题名，
 * 也让「已在库」的去重失效：
 *   阿加莎69：H庄园的午餐   → H庄园的午餐
 *   阿加莎·克里斯蒂作品11:尼罗河上的惨案 → 尼罗河上的惨案
 *   五只小猪/阿加莎·克里斯蒂作品 → 五只小猪
 *   天涯过客：第2版        → 天涯过客
 */
function stripCatalogMarkers(t) {
  let s = String(t).trim();
  s = s.replace(/^[】\]]+/, '');
  // 「阿加莎NN：」「阿加莎·克里斯蒂作品NN:」这类前缀 —— 冒号后才是书名
  const pre = s.match(/^(?:[^：:]{0,4}·?)?(?:阿加莎|克里斯蒂|奎因|江户川乱步|东野圭吾|松本清张|岛田庄司)?[^：:]{0,3}?(?:作品)?\s*\d{0,3}\s*[：:]\s*(.+)$/);
  // 只有当冒号**前面**确实是「作者名／丛书编号」这类前缀时才剥，别把书名自带的冒号剥掉
  if (pre && /阿加莎|克里斯蒂|作品|东野圭吾|奎因|江户川乱步|松本清张|岛田庄司/.test(s.slice(0, s.indexOf(pre[1])))) s = pre[1];
  // 「书名/阿加莎·克里斯蒂作品」「书名：阿加莎」这类后缀
  s = s.replace(/[：:/]\s*(?:阿加莎|克里斯蒂|江户川乱步|东野圭吾)[^：:/]*$/, '');
  s = s.replace(/\/[^/：:]{0,20}作品[^/：:]*$/, '');
  // 「：第2版」这类版次后缀
  s = s.replace(/[：:]\s*第\s*\d+\s*版$/, '');
  s = s.replace(/[：:]\s*$/, '');
  return s.trim();
}

const rows = readFileSync(inFile, 'utf8').split(/\r?\n/).filter(Boolean);
const kept = [];
const skipped = { noise: 0, have: 0, short: 0 };
for (const line of rows) {
  const title = stripCatalogMarkers(leadTitle((line.split('\t')[1] ?? '').trim()));
  if (!title || title.length < 2) {
    skipped.short++;
    continue;
  }
  if (NOISE.test(title)) {
    skipped.noise++;
    continue;
  }
  const n = norm(title);
  if (!n || have.has(n)) {
    skipped.have++;
    continue;
  }
  kept.push(title);
}

const uniq = [...new Set(kept)];
writeFileSync(outFile, uniq.join('\n') + '\n', 'utf8');
console.log(`输入 ${rows.length} 条 → 去重后待检 ${uniq.length} 个题名`);
console.log(`剔除：套装/合集/营销残片 ${skipped.noise}、短残片 ${skipped.short}、已在库 ${skipped.have}`);
console.log(`已写入 ${outFile}`);
console.log('\n前 25 个：');
for (const t of uniq.slice(0, 25)) console.log(`  · ${t}`);
