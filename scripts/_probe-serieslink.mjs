// 一次性：看详情页的「丛编项」是不是链接 —— 若是，那个 URL 就是丛书枚举的钥匙
import { get, SITES, search } from './lib/uibe.mjs';

// 先用题名检索定位一本「午夜文库」的书
const r = await search('逆光的子弹', { site: 'uibe' });
const row = r.rows.find((x) => x.title.includes('逆光的子弹'));
if (!row) {
  console.log('没找到样例书，退出');
  process.exit(0);
}
console.log('样例书：', row.title, row.bookId);

const html = await get(`${SITES.uibe.base}/opac/book/${row.bookId}`);
const i = html.indexOf('丛编');
console.log('\n=== 「丛编」附近原文（2600 字）===');
console.log(html.slice(Math.max(0, i - 200), i + 2400).replace(/\s+/g, ' '));
