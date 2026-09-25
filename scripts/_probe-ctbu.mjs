// 一次性：探第二个馆（ctbu，金盘 OPAC）是否支持按分类号/索书号检索
// 若支持，就能枚举一批**与第一个馆不同的馆藏**——这是全新的一段书目。
import { get, SITES, parseList, resultCount } from './lib/uibe.mjs';

const s = SITES.ctbu;
console.log('ctbu 配置：', JSON.stringify(s));

const cases = [
  ['原样分类号 I247.56', 'q=I247.56'],
  ['通配 I247.56*', 'q=I247.56%2A'],
  ['索书号字段 I247.56*', 'q=I247.56%2A&searchType=callno'],
  ['题名 密室', 'q=%E5%AF%86%E5%AE%A4'],
  ['检索词 推理小说', 'q=%E6%8E%A8%E7%90%86%E5%B0%8F%E8%AF%B4'],
];
for (const [tag, qs] of cases) {
  await new Promise((r) => setTimeout(r, 900));
  try {
    const html = await get(`${s.base}${s.path}?${qs}`);
    const rows = parseList(html, 'ctbu');
    console.log(`${tag.padEnd(24)} → ${String(resultCount(html)).padStart(6)} 条 | ${rows.slice(0, 4).map((x) => x.title).join(' / ') || '（无）'}`);
  } catch (e) {
    console.log(`${tag.padEnd(24)} → 失败：${e.message}`);
  }
}
