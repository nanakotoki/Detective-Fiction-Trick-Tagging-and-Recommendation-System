// 一次性：探测「按索书号检索」能不能用来整类枚举中图法 I247.56 的书
import { get, SITES, resultCount, parseList } from './lib/uibe.mjs';

const cases = [
  ['callNumber I247.56', 'q=I247.56&field=callNumberSearch'],
  ['callNumber I247.5', 'q=I247.5&field=callNumberSearch'],
  ['callNumber I247', 'q=I247&field=callNumberSearch'],
  ['callNumber I313.456', 'q=I313.456&field=callNumberSearch'],
  ['callNumber 完整索书号样例', 'q=I247.56%2F4023&field=callNumberSearch'],
  ['title I247.56 对照', 'q=I247.56&field=title'],
];
for (const [tag, qs] of cases) {
  await new Promise((r) => setTimeout(r, 1100));
  try {
    const html = await get(`${SITES.uibe.base}${SITES.uibe.path}?${qs}`);
    const rows = parseList(html);
    console.log(`${tag.padEnd(26)} → ${String(resultCount(html)).padStart(6)} 条 | ${rows.slice(0, 5).map((x) => `${x.title}(${x.callNumber || '-'})`).join(' / ')}`);
  } catch (e) {
    console.log(`${tag.padEnd(26)} → 失败：${e.message}`);
  }
}
