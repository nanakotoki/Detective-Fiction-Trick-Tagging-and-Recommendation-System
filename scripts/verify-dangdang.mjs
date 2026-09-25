// 一次性：按商品 ID 打印当当书目字段 + AJAX 详情（编辑推荐/内容简介）
// 用法: node scripts/verify-dangdang.mjs <id> [id...]
import { productInfo, productDetail } from './lib/dd-detail.mjs';

for (const id of process.argv.slice(2)) {
  console.log(`\n################ ${id}`);
  let info = null;
  try {
    info = await productInfo(id);
    console.log(`  题名：${info.title.slice(0, 120)}`);
    console.log(`  作者=${info.author}  出版社=${info.publisher}  出版=${info.pubDate}  ISBN=${info.isbn}`);
    console.log(`  shopId=${info.shopId || '-'}  categoryPath=${info.categoryPath || '-'}`);
    if (info.store) console.log(`  店铺=${info.store}`);
  } catch (e) {
    console.log(`  书目失败：${e.message}`);
  }
  try {
    const d = await productDetail(id, {
      shopId: info?.shopId || '0',
      categoryPath: info?.categoryPath || '01.03.38.00.00.00',
    });
    console.log(`  ── 编辑推荐 ──\n${(d.editor || '(空)').slice(0, 700)}`);
    console.log(`  ── 内容简介 ──\n${(d.content || '(空)').slice(0, 900)}`);
    if (!d.editor && !d.content) console.log(`  ── 全文 ──\n${d.full.slice(0, 500)}`);
  } catch (e) {
    console.log(`  详情失败：${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 700));
}
