#!/usr/bin/env node
/** 豆瓣连通性诊断：条目页 / 丛书页各自是否可用（维护工具）
 *  用法：node scripts/diag-douban-access.mjs [subjectId...] [--series id...] */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const argv = process.argv.slice(2);
const si = argv.indexOf('--series');
const subjIds = argv.filter((a) => /^\d+$/.test(a));
const seriesIds = si === -1 ? [] : argv.slice(si + 1).filter((a) => /^\d+$/.test(a));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(label, url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
  const body = await res.text();
  const title = (body.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1].trim();
  // 反爬页的特征：标题只有「豆瓣」，且整页只有三行左右的样式壳
  const blocked = title === '豆瓣' || body.length < 6000;
  console.log(
    `  ${blocked ? '✗ 被拦' : '✓ 正常'}  ${label}  HTTP ${res.status}  ${body.length} 字节  title=${title || '(空)'}`,
  );
  await sleep(1600);
  return !blocked;
}

console.log('');
console.log('  豆瓣连通性诊断（条目页与丛书页分开看，反爬通常先掐丛书页）');
console.log('  ────────────────────────────────────────────');
for (const id of seriesIds) await probe(`series/${id}`, `https://book.douban.com/series/${id}/`);
for (const id of subjIds) await probe(`subject/${id}`, `https://book.douban.com/subject/${id}/`);
if (!subjIds.length && !seriesIds.length) {
  await probe('subject/37268610', 'https://book.douban.com/subject/37268610/');
  await probe('series/693', 'https://book.douban.com/series/693/');
}
console.log('');
