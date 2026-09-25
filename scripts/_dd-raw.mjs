// 一次性：抓一个 URL 存原文并报告关键特征（判断是拦截页/改版/正常列表）
// 用法: node scripts/_dd-raw.mjs <URL> [输出文件]
import { writeFileSync } from 'node:fs';
import { fetchDecoded } from './lib/dangdang.mjs';

const url = process.argv[2];
const out = process.argv[3] || '';
if (!url) {
  console.error('用法: node scripts/_dd-raw.mjs <URL> [输出文件]');
  process.exit(1);
}
const text = await fetchDecoded(url);
console.log(`长度 ${text.length}`);
const title = (text.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1];
console.log(`title = ${title}`);
for (const k of ['id="p', 'class="name"', 'search_book_author', '验证', 'verify', 'captcha', 'robots', '抱歉', '不存在', 'product.dangdang']) {
  console.log(`  ${k}: ${text.split(k).length - 1} 次`);
}
console.log('\n--- 头部 800 字 ---');
console.log(text.slice(0, 800).replace(/\s+/g, ' '));
if (out) {
  writeFileSync(out, text, 'utf8');
  console.log(`\n已写入 ${out}`);
}
