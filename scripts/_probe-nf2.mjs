/**
 * 一次性探针 2：把「未命中」书名的检索**原始行**打出来
 *
 * 探针 1 显示：简化题名后仍无作者吻合命中，但检索**返回了 10 行**。
 * 于是要看清那 10 行到底是什么——是「馆里确实没有这本书」，还是
 * 「题名检索被拆成单字模糊匹配，返回一堆不相干的书」。
 *
 * 用法：node scripts/_probe-nf2.mjs "犬神家一族" "匣中失乐" "独眼少女"
 */
import { search } from './lib/uibe.mjs';

for (const title of process.argv.slice(2)) {
  try {
    const res = await search(title, { site: 'uibe' });
    console.log(`\n=== 《${title}》 count=${res.count} rows=${res.rows.length}`);
    for (const r of res.rows.slice(0, 10)) {
      console.log(`   ${r.title} ／ ${r.author} ／ ${r.publisher} ／ ${(r.subjects || []).join(',')}`);
    }
  } catch (e) {
    console.log(`=== 《${title}》 检索失败：${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 900));
}
