// 一次性：按中图法复分号通配枚举，确认各语区的可用类号
import { get, SITES, resultCount, parseList } from './lib/uibe.mjs';

const CLASSES = [
  'I247.56', 'I247.5', 'I313.456', 'I313.45', 'I561.456', 'I561.45',
  'I712.456', 'I712.45', 'I565.456', 'I516.456', 'I246.56', 'I246.7',
];
for (const c of CLASSES) {
  await new Promise((r) => setTimeout(r, 950));
  try {
    const html = await get(`${SITES.uibe.base}${SITES.uibe.path}?q=${encodeURIComponent(c + '*')}&field=callNumberSearch`);
    const rows = parseList(html);
    const mystery = rows.filter((x) => /推理小说|侦探小说/.test((x.subjects || []).join(' ')));
    console.log(`${c.padEnd(10)} → ${String(resultCount(html)).padStart(5)} 条 | 本页主题词为推理的 ${mystery.length}/${rows.length} | ${rows.slice(0, 3).map((x) => x.title).join(' / ')}`);
  } catch (e) {
    console.log(`${c.padEnd(10)} → 失败：${e.message}`);
  }
}
