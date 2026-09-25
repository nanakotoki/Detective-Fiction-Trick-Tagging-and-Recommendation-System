// 一次性：试索书号的通配 / 前缀匹配
import { get, SITES, resultCount, parseList } from './lib/uibe.mjs';

const cases = [
  ['精确 I247.56/S50', 'q=I247.56%2FS50&field=callNumberSearch'],
  ['百分号 I247.56%', 'q=I247.56%25&field=callNumberSearch'],
  ['星号 I247.56*', 'q=I247.56*&field=callNumberSearch'],
  ['斜杠尾 I247.56/', 'q=I247.56%2F&field=callNumberSearch'],
  ['空格 I247.56 ', 'q=I247.56+&field=callNumberSearch'],
  ['不带 field I247.56/S50', 'q=I247.56%2FS50'],
];
for (const [tag, qs] of cases) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    const html = await get(`${SITES.uibe.base}${SITES.uibe.path}?${qs}`);
    const rows = parseList(html);
    console.log(`${tag.padEnd(24)} → ${String(resultCount(html)).padStart(5)} 条 | ${rows.slice(0, 4).map((x) => `${x.title}(${x.callNumber})`).join(' / ') || '（无）'}`);
  } catch (e) {
    console.log(`${tag.padEnd(24)} → 失败：${e.message}`);
  }
}
