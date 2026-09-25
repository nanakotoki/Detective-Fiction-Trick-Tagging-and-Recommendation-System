// 一次性：按检索表单里暴露的真实 field 取值逐个测试
import { get, SITES, resultCount, parseList } from './lib/uibe.mjs';

const cases = [
  ['field=creatorSearch', 'q=%E9%81%93%E5%B0%94%E8%91%97&field=creatorSearch'],
  ['field=title', 'q=%E6%8E%A8%E7%90%86&field=title'],
  ['field=abstract', 'q=%E5%AF%86%E5%AE%A4&field=abstract'],
  ['field=subjectdef', 'q=%E6%8E%A8%E7%90%86%E5%B0%8F%E8%AF%B4&field=subjectdef'],
  ['field=subjectdef empty-q', 'field=subjectdef'],
  ['field=publisher', 'q=%E6%96%B0%E6%98%9F%E5%87%BA%E7%89%88%E7%A4%BE&field=publisher'],
  ['field=callNumberSearch', 'q=I247.56&field=callNumberSearch'],
  ['no-field + searchModel=seg', 'q=%E6%8E%A8%E7%90%86%E5%B0%8F%E8%AF%B4&searchModel=seg'],
];
for (const [tag, qs] of cases) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    const html = await get(`${SITES.uibe.base}${SITES.uibe.path}?${qs}`);
    const rows = parseList(html);
    console.log(`${tag.padEnd(28)} → ${String(resultCount(html)).padStart(6)} 条 | ${rows.slice(0, 4).map((x) => x.title).join(' / ') || '（无行）'}`);
  } catch (e) {
    console.log(`${tag.padEnd(28)} → 失败：${e.message}`);
  }
}
