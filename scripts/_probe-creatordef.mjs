/**
 * 一次性探针 2：`creatordef` / `subjectdef` / `publisherdef` 是不是**精确检索**
 * =======================================================================
 * 检索页上 `field` 的可选值比我上一轮记的多——除了 `creatorSearch`、`subject`、`publisher`，
 * 还有一组 `xxx**def**`：`creatordef`、`subjectdef`、`publisherdef`。
 * 命名上像「精确／前方一致」的那一档，而 `creatorSearch` 才是宽松档。
 *
 * 判据：拿确定的作者名去查，看
 *   ① 结果条数是否收敛到「该馆真有的那几本」；
 *   ② 行内作者是否**清一色**是这位作者（宽松档会因为单字 OR 匹配混进别人）。
 */
import { SITES, get, resultCount, parseList } from './lib/uibe.mjs';

const CASES = [
  { q: '宫部美雪', expect: /宫部/ },
  { q: '横沟正史', expect: /横沟/ },
  { q: '阿加莎·克里斯蒂', expect: /克里斯蒂/ },
  { q: '折原一', expect: /折原/ },
];

for (const [field, label] of [
  ['creatorSearch', '宽松档 creatorSearch'],
  ['creatordef', '待验档 creatordef'],
]) {
  console.log(`\n########## ${label} ##########`);
  for (const c of CASES) {
    try {
      const qs = `q=${encodeURIComponent(c.q)}&field=${field}`;
      const html = await get(`${SITES.uibe.base}${SITES.uibe.path}?${qs}`);
      const rows = parseList(html);
      const ok = rows.filter((r) => c.expect.test(r.author || '')).length;
      console.log(
        `\n【${c.q}】total=${resultCount(html)} 本页 ${rows.length} 行，作者吻合 ${ok} 行`,
      );
      for (const r of rows.slice(0, 6)) {
        console.log(`    ${r.title} ／ ${r.author} ／ ${(r.subjects || []).join(',')}`);
      }
    } catch (e) {
      console.log(`【${c.q}】✗ ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 800));
  }
}

console.log('\n########## 题名：犬神家一族（title vs documentsTitle） ##########');
for (const field of ['title', 'documentsTitle', 'all']) {
  try {
    const html = await get(
      `${SITES.uibe.base}${SITES.uibe.path}?q=${encodeURIComponent('犬神家一族')}&field=${field}`,
    );
    const rows = parseList(html);
    const ok = rows.filter((r) => /横沟/.test(r.author || '')).length;
    console.log(`  ${field.padEnd(16)} total=${String(resultCount(html)).padEnd(8)} 横沟命中 ${ok}  首行：${rows[0]?.title ?? '（无）'}／${rows[0]?.author ?? ''}`);
  } catch (e) {
    console.log(`  ${field.padEnd(16)} ✗ ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 800));
}
