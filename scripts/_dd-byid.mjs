// 一次性：按商品 ID 取当当详情页的关键字段（含 meta description 里的梗概）
// 用法: node scripts/_dd-byid.mjs <id> [id...]
import { fetchDecoded, strip } from './lib/dangdang.mjs';

for (const id of process.argv.slice(2)) {
  console.log(`\n########## ${id}`);
  let t;
  try {
    t = await fetchDecoded(`http://product.dangdang.com/${id}.html`);
  } catch (e) {
    console.log(`  失败：${e.message}`);
    continue;
  }
  const h1 = strip((t.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [, ''])[1]);
  const md = (t.match(/<meta\s+name="[Dd]escription"\s+content="([^"]*)"/) || [, ''])[1];
  const mk = (t.match(/<meta\s+name="[Kk]eywords"\s+content="([^"]*)"/) || [, ''])[1];
  const info = t.match(/messbox_info[\s\S]{0,1400}?<\/div>/);
  const isbn = (t.match(/ISBN[：:]\s*([\d\-Xx]{10,20})/) || [, ''])[1];
  const store = (t.match(/<title>[\s\S]*?-\s*当当\s*-\s*([^<]*)<\/title>/) || [, ''])[1];
  console.log(`  h1：${h1.slice(0, 110)}`);
  console.log(`  店铺：${store}`);
  console.log(`  信息：${info ? strip(info[0]).replace(/^messbox_info/, '').slice(0, 260) : '(无)'}`);
  console.log(`  ISBN：${isbn}`);
  console.log(`  meta描述：${strip(md).slice(0, 700)}`);
  console.log(`  meta关键词：${strip(mk).slice(0, 200)}`);
  await new Promise((r) => setTimeout(r, 600));
}
