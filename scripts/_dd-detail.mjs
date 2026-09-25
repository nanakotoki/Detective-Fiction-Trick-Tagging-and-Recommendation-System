// 一次性：对一组书名做「检索→挑正条→取详情」，输出紧凑记录供人工取证
// 用法: node scripts/_dd-detail.mjs 书名1 书名2 ...
import { search, product, strip } from './lib/dangdang.mjs';
import { leadTitle, authorOf } from './lib/dd-title.mjs';

const titles = process.argv.slice(2);
for (const t of titles) {
  console.log(`\n########## ${t}`);
  let rows;
  try {
    ({ rows } = await search(t));
  } catch (e) {
    console.log(`  检索失败：${e.message}`);
    continue;
  }
  const hits = rows.filter((r) => leadTitle(r.title) === t);
  console.log(`  检索命中 ${rows.length} 条，正条 ${hits.length} 条`);
  // 取「有出版社且有日期」的第一条，否则取第一条
  const scored = hits
    .map((r) => {
      const d = (r.authorLine.match(/\d{4}-\d{2}-\d{2}/) || [])[0] || '';
      return { r, d, ok: d && /出版社/.test(r.authorLine) ? 1 : 0 };
    })
    .sort((a, b) => b.ok - a.ok || (a.d || '9').localeCompare(b.d || '9'));
  const pick = scored[0];
  if (!pick) {
    console.log('  （无正条，跳过详情）');
    continue;
  }
  console.log(`  id=${pick.r.id}`);
  console.log(`  作者行：${strip(pick.r.authorLine).slice(0, 120)}`);
  console.log(`  解析作者：${authorOf(pick.r.authorLine)}`);
  console.log(`  列表短简介：${pick.r.detail.slice(0, 200)}`);
  try {
    const d = await product(pick.r.id);
    console.log(`  详情title：${d.title.slice(0, 120)}`);
    console.log(`  出版社=${d.publisher}  出版时间=${d.pubDate}  ISBN=${d.isbn}`);
    console.log(`  详情简介：${d.intro.slice(0, 700) || '(空)'}`);
  } catch (e) {
    console.log(`  详情页失败：${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 600));
}
