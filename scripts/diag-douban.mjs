#!/usr/bin/env node
/**
 * 豆瓣详情页解析自检（维护工具）
 * ============================
 * `refresh-ratings.mjs` 在详情页里找评分。如果豆瓣改版或被反爬，
 * 会出现「所有书都变成暂无评分」这种**静默错误**——图谱看起来正常，
 * 实际全库评分停止更新。
 *
 * 本脚本直接抓一个**确定有评分**的条目，把页面里所有可能与评分相关的
 * 片段原样打印出来，用来判断到底是解析器坏了、还是真的被反爬拦了。
 *
 * 用法：
 *   node scripts/diag-douban.mjs                默认用一个高人气条目自检
 *   node scripts/diag-douban.mjs 1082154        指定豆瓣条目 id
 *   node scripts/diag-douban.mjs --url https://book.douban.com/subject/1082154/
 */

import { parseDoubanSubject } from '../web/js/core/ratings.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const argv = process.argv.slice(2);
const urlIdx = argv.indexOf('--url');
const url =
  urlIdx !== -1
    ? argv[urlIdx + 1]
    : `https://book.douban.com/subject/${argv.find((a) => /^\d+$/.test(a)) || '1082154'}/`;

console.log('');
console.log(`  抓取 ${url}`);
const res = await fetch(url, {
  headers: {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  },
});
const body = await res.text();
console.log(`  HTTP ${res.status}  长度 ${body.length} 字节`);
console.log(`  标题标签：${(body.match(/<title>([\s\S]*?)<\/title>/) || [, '(无)'])[1].trim()}`);
console.log('');

// 反爬特征
const botSignals = [
  ['有验证/异常跳转', /有异常请求|检测到异常|sec\.douban\.com|请输入验证码/],
  ['是 JS 挑战页', /window\.location\.replace|<script>var\s+\w+\s*=\s*['"]/],
  ['正文容器缺失', /<div id="wrapper">[\s\S]{0,200}<\/div>/],
];
for (const [label, re] of botSignals) {
  console.log(`  ${re.test(body) ? '⚠' : '✓'} ${label}`);
}
console.log('');

// 评分相关的原始片段
console.log('  评分相关片段：');
const patterns = [
  ['rating_num 类名', /rating_num[^>]{0,120}/g],
  ['v:average', /v:average[^>]{0,120}/g],
  ['ratingValue', /ratingValue["'\s:]{0,6}[^,}]{0,40}/g],
  ['rating_per', /rating_per[^>]{0,80}/g],
  ['ratingCount / 评价人数', /(?:ratingCount|评价人数|rating_people)[^<]{0,120}/g],
  ['aggregateRating 区块', /aggregateRating[\s\S]{0,400}?}/g],
];
let found = 0;
for (const [label, re] of patterns) {
  const hits = body.match(re) || [];
  console.log(`    ${label}：${hits.length} 处`);
  for (const h of hits.slice(0, 3)) {
    console.log(`        ${h.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
  found += hits.length;
}
console.log('');

// 交给真正的解析器
const parsed = parseDoubanSubject(body);
console.log('  parseDoubanSubject 结果：');
console.log(`    ${JSON.stringify(parsed)}`);
console.log('');
console.log(
  parsed && parsed.score != null
    ? '  ✓ 解析器正常。若 refresh-ratings 仍报「暂无评分」，问题在候选筛选或网络层。'
    : found > 0
      ? '  ✗ 页面里有评分痕迹，但解析器取不到 —— 解析规则需要更新。'
      : '  ✗ 页面里没有任何评分痕迹 —— 多半是被反爬拦了，稍后重试。'
);
console.log('');
