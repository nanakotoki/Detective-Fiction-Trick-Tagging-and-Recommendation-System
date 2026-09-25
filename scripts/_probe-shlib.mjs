/**
 * 探针 4：上海图书馆 VuFind API 的字段结构、精确性与分页
 * ====================================================
 * 探针 3 的结论：`https://vufind.library.sh.cn/api/v1/search` 的 `type=Author`
 * **是真正的作者索引**（宫部美雪返回 54 条，前 5 条全是她本人的作品），
 * 而第一个馆的 `creatorSearch` 对同一位作者 60 行里 0 行命中。
 *
 * 本探针要摸清三件事，才能把它接成采集渠道：
 *   ① 记录里有那些字段（题名／作者／出版项／主题／中图法／ISBN）；
 *   ② `type=Author` 是精确还是模糊（拿「折原一」验：不应混进「折原美都」）；
 *   ③ 分页参数与单页上限。
 */
const BASE = 'https://vufind.library.sh.cn';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function api(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'user-agent': UA, accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(text);
}

console.log('=== ① 记录字段（原始 JSON，前 1 条）===');
const s1 = await api('/api/v1/search?lookfor=%E5%AE%AB%E9%83%A8%E7%BE%8E%E9%9B%AA&type=Author&limit=3');
console.log(JSON.stringify(s1.records?.[0], null, 1).slice(0, 2200));
console.log('\n顶层键：', Object.keys(s1).join(', '));
console.log('分面：', JSON.stringify(s1.facets ?? {}).slice(0, 400));

console.log('\n=== ② 作者精确性 ===');
for (const name of ['折原一', '宫部美雪', '横沟正史', '阿加莎·克里斯蒂', '三津田信三']) {
  const j = await api(`/api/v1/search?lookfor=${encodeURIComponent(name)}&type=Author&limit=100`);
  const recs = j.records || [];
  const hit = recs.filter((r) => JSON.stringify(r.authors || {}).includes(name)).length;
  console.log(`【${name}】resultCount=${j.resultCount} 本页 ${recs.length} 条，作者字段含全名 ${hit} 条`);
  console.log(`    前 6：${recs.slice(0, 6).map((r) => r.title).join('、')}`);
  await new Promise((r) => setTimeout(r, 500));
}

console.log('\n=== ③ 分页与单页上限 ===');
for (const limit of [20, 100, 300]) {
  try {
    const j = await api(`/api/v1/search?lookfor=%E5%AE%AB%E9%83%A8%E7%BE%8E%E9%9B%AA&type=Author&limit=${limit}`);
    console.log(`  limit=${String(limit).padStart(3)} → 返回 ${j.records?.length ?? 0} 条`);
  } catch (e) {
    console.log(`  limit=${limit} ✗ ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 400));
}
const p2 = await api('/api/v1/search?lookfor=%E5%AE%AB%E9%83%A8%E7%BE%8E%E9%9B%AA&type=Author&limit=20&page=2');
console.log(`  page=2 → ${p2.records?.length ?? 0} 条，首条：${p2.records?.[0]?.title ?? '（无）'}`);

console.log('\n=== ④ 单条详情的字段（取第一条）===');
const id = s1.records?.[0]?.id;
if (id) {
  try {
    const d = await api(`/api/v1/record?id=${encodeURIComponent(id)}`);
    console.log(JSON.stringify(d, null, 1).slice(0, 2600));
  } catch (e) {
    console.log(`  详情 ✗ ${e.message}`);
  }
}
