/**
 * 探针 5：上图单条记录页能取到哪些判据字段（主题词／中图法／出版项／丛编）
 * =====================================================================
 * `api/v1/search` 只回摘要（authors / subjects / series / title），**没有出版项与中图法**，
 * 而这两项正是本项目题材判据与 `editionYear` 的来源。所以要看单条记录页（HTML）。
 *
 * 同时试 API 的 `field[]` 参数，看能不能直接把 MARC 字段要到 JSON 里。
 */
const BASE = 'https://vufind.library.sh.cn';
const ID = '96814dc1-47e7-42f3-8255-8bad01890510';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
  return { status: res.status, text: await res.text() };
}

console.log('=== ① API 加 field[] 要更多字段 ===');
for (const extra of [
  '&field[]=classification&field[]=publishDate&field[]=publishers',
  '&field[]=all',
]) {
  try {
    const r = await get(`${BASE}/api/v1/record?id=${ID}${extra}`);
    const j = JSON.parse(r.text);
    console.log(`  ${extra}`);
    console.log(`    键：${Object.keys(j.records?.[0] ?? {}).join(', ')}`);
  } catch (e) {
    console.log(`  ${extra} ✗ ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 500));
}

console.log('\n=== ② 记录页 HTML 里找判据字段 ===');
const r = await get(`${BASE}/Record/${ID}`);
console.log(`  status=${r.status} bytes=${r.text.length}`);
const text = r.text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
const flat = text
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const KEYS = ['出版社', '出版年', '出版发行', '主题', '中图', '分类号', 'ISBN', '丛编', '索书号', '载体形态', '提要', '摘要'];
for (const k of KEYS) {
  const i = flat.indexOf(k);
  console.log(`  ${k.padEnd(6)} ${i >= 0 ? '✓ ' + flat.slice(i, i + 110) : '✗ 未出现'}`);
}

console.log('\n=== ③ 记录页的 MARC / 详情区块标题 ===');
const heads = [...text.matchAll(/<h[23][^>]*>([\s\S]{0,80}?)<\/h[23]>/gi)].map((m) =>
  m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
);
console.log('  ' + [...new Set(heads)].slice(0, 30).join(' | '));

console.log('\n=== ④ 、试 MARC 视图 ===');
for (const p of ['/Record/' + ID + '/Marc', '/Record/' + ID + '/Export?style=MARC']) {
  const rr = await get(`${BASE}${p}`);
  const has = /中图|主题|出版|分类/.test(rr.text);
  console.log(`  ${p} status=${rr.status} bytes=${rr.text.length} 含中文编目词=${has}`);
  await new Promise((res) => setTimeout(res, 400));
}
