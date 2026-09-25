// 一次性：看 ctbu 关键词检索命中的行有没有主题词（决定下一步用什么筛法）
import { search, detail } from './lib/uibe.mjs';

for (const kw of ['密室', '推理小说', '侦探']) {
  await new Promise((r) => setTimeout(r, 900));
  const res = await search(kw, { site: 'ctbu' });
  console.log(`\n===== 「${kw}」ctbu 命中 ${res.rows.length} 行 =====`);
  for (const row of res.rows.slice(0, 6)) {
    console.log(`  ${row.title} | ${row.author} | 主题词：「${(row.subjects || []).join(' / ') || '（空）'}」`);
  }
  // 取第一条的详情，看详情页有没有主题词
  if (res.rows[0]) {
    await new Promise((r) => setTimeout(r, 700));
    try {
      const d = await detail(res.rows[0].bookId, { site: 'ctbu' });
      console.log(`  → 详情页样例《${res.rows[0].title}》：主题词「${d.subjects || '（空）'}」 | 中图「${d.clc || '-'}」 | ${d.imprint}`);
    } catch (e) {
      console.log(`  → 详情页失败：${e.message}`);
    }
  }
}
