// 一次性：看 uibe 检索结果页里的分面/链接格式
import { get, SITES } from './lib/uibe.mjs';
const html = await get(`${SITES.uibe.base}${SITES.uibe.path}?q=%E4%BE%A6%E6%8E%A2%E5%B0%8F%E8%AF%B4`);
const hrefs = [...new Set([...html.matchAll(/href\s*=\s*"([^"]*)"/g)].map((m) => m[1].replace(/\s+/g, '')))];
console.log('== 含 search 的链接 ==');
console.log(hrefs.filter((h) => /search|subject|facet|clc|series/i.test(h)).slice(0, 40).join('\n'));
console.log('\n== class 里含 facet/subject/nav 的容器 ==');
console.log([...new Set([...html.matchAll(/class\s*=\s*"([^"]*)"/g)].map((m) => m[1]))].filter((c) => /facet|subject|refine|filter|nav/i.test(c)).slice(0, 30).join(' | '));
console.log('\n== 表单 input/select（找隐藏参数名）==');
console.log([...new Set([...html.matchAll(/<(?:input|select)[^>]*name\s*=\s*"([^"]*)"/g)].map((m) => m[1]))].join(' | '));
console.log('\n== 主题词分面附近原文（截 1200 字）==');
const i = html.indexOf('主题词');
console.log(i < 0 ? '（结果页无「主题词」字样）' : html.slice(i - 300, i + 900).replace(/\s+/g, ' '));
