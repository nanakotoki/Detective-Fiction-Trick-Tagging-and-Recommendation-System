// 一次性：探测「丛书名」能否作为检索词命中该丛书的书
import { search, SITES, get, resultCount, parseList } from './lib/uibe.mjs';

const SERIES = ['午夜文库', '蜘蛛文库', '千本樱', '读客悬疑', '大英图书馆', '域外故事会', '谋杀专门店', '黑猫文库', '谜托邦', '现代推理馆', '99读书人', '奇案俱乐部'];

for (const kw of SERIES) {
  await new Promise((r) => setTimeout(r, 950));
  try {
    // 用不传 field 的全字段检索（与 opac-facet-scan 一致）
    const r = await search(kw, { site: 'uibe' });
    const mystery = r.rows.filter((x) => /推理小说|侦探小说/.test((x.subjects || []).join(' ')));
    console.log(`【${kw}】共 ${r.count} 条 | 本页 ${r.rows.length} 行 | ${mystery.length} 行主题词是推理`);
    console.log(`    样例：${r.rows.slice(0, 4).map((x) => x.title).join(' / ') || '（无）'}`);
  } catch (e) {
    console.log(`【${kw}】失败：${e.message}`);
  }
}
