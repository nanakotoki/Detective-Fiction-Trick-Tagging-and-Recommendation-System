// 一次性：验证按作者枚举（creatorSearch）是否可用、每页多少、行内是否带主题词
import { get, SITES, resultCount, parseList } from './lib/uibe.mjs';
const AUTHORS = ['江户川乱步', '东野圭吾', '阿加莎·克里斯蒂', '横沟正史'];
for (const a of AUTHORS) {
  await new Promise((r) => setTimeout(r, 1000));
  const qs = `q=${encodeURIComponent(a)}&field=creatorSearch`;
  try {
    const html = await get(`${SITES.uibe.base}${SITES.uibe.path}?${qs}`);
    const rows = parseList(html);
    const mystery = rows.filter((x) => /推理小说|侦探小说/.test((x.subjects || []).join(' ')));
    console.log(`\n【${a}】共 ${resultCount(html)} 条，本页 ${rows.length} 行，主题词判为推理的 ${mystery.length} 行`);
    for (const r of rows.slice(0, 5)) console.log(`   ${r.title} | ${r.author} | ${(r.subjects || []).join(' ')}`);
  } catch (e) { console.log(`【${a}】失败 ${e.message}`); }
}
