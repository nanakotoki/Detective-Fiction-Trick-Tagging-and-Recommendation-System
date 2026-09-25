// 一次性：按 ISBN 检索当当，打印命中行的题名与短简介（自营条目常带梗概）
// 用法: node scripts/_dd-isbn.mjs <isbn> [isbn...]
import { search, strip } from './lib/dangdang.mjs';

for (const isbn of process.argv.slice(2)) {
  console.log(`\n########## ${isbn}`);
  try {
    const { rows } = await search(isbn);
    console.log(`  命中 ${rows.length} 条`);
    for (const r of rows.slice(0, 6)) {
      console.log(`  · ${strip(r.title).slice(0, 110)}`);
      console.log(`    ${strip(r.authorLine).slice(0, 90)}`);
      if (r.detail) console.log(`    简介：${strip(r.detail).slice(0, 420)}`);
    }
  } catch (e) {
    console.log(`  检索失败：${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 600));
}
