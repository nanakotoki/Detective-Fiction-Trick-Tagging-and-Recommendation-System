// 一次性：探测 OPAC 的 field 参数哪些真的生效
import { search } from './lib/uibe.mjs';

const FIELDS = ['', 'titleSearch', 'creatorSearch', 'subjectSearch', 'seriesSearch', 'clcSearch', 'publisherSearch', 'anywhere'];
const Q = process.argv[2] || '推理小说';

const base = await search(Q, { field: '' });
const sig = (r) => `${r.count}|${r.rows.slice(0, 3).map((x) => x.title).join(' / ')}`;
console.log(`基线 field='' → ${sig(base)}`);
const baseKey = base.rows.map((x) => x.bookId).join(',');

for (const f of FIELDS.slice(1)) {
  await new Promise((r) => setTimeout(r, 900));
  try {
    const r = await search(Q, { field: f });
    const same = r.rows.map((x) => x.bookId).join(',') === baseKey;
    console.log(`field=${f.padEnd(17)} → 共 ${String(r.count).padStart(6)} 条  ${same ? '（与基线相同，疑为无效参数）' : ''}`);
    if (!same) console.log(`      ${sig(r)}`);
  } catch (e) {
    console.log(`field=${f.padEnd(17)} → 失败：${e.message}`);
  }
}
