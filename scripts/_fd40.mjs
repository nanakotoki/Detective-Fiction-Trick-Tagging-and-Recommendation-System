// 一次性：按题名直接检索并取详情（多作者合集批）
import { search, searchBoth, detail, subjectVerdict } from './lib/uibe.mjs';

const titles = process.argv.slice(2);
for (const t of titles) {
  console.log(`\n### ${t}`);
  let row = null;
  let site = 'uibe';
  let saw = [];
  for (const s of ['uibe', 'ctbu']) {
    try {
      // field='title' 是这个 OPAC 表单里真正生效的题名检索值；
      // 不传 field 只做宽泛关键词匹配，长书名往往命不中（会返回一堆无关记录）
      const r = await search(t, { site: s, field: 'title' });
      saw = r.rows.slice(0, 3).map((x) => x.title);
      row = r.rows.find((x) => x.title.includes(t)) || null;
      if (row) { site = s; break; }
    } catch (e) { /* 换下一个馆 */ }
    await new Promise((r) => setTimeout(r, 700));
  }
  if (!row) { console.log(`  （未命中；该馆返回的前几条：${saw.join(' / ') || '无'}）`); continue; }
  try {
    const d = await detail(row.bookId, { site });
    const v = subjectVerdict(d.subjects);
    console.log(`  题名=${row.title} | 著者=${row.author} | 出版=${d.imprint || row.publisher} | 判据=${v.mystery ? '★是' : '否'}`);
    console.log(`  主题=${d.subjects || '-'}`);
    console.log(`  丛编=${d.series || '-'} | 中图=${d.clc || '-'}`);
    console.log(`  提要=${(d.abstract || '-').slice(0, 190)}`);
  } catch (e) { console.log(`  详情失败：${e.message}`); }
  await new Promise((r) => setTimeout(r, 750));
}
