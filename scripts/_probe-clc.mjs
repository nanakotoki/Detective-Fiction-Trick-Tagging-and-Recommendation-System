// 一次性：探测「分类号当检索词」与 ctbu 的字段参数
import { search, SITES, get, resultCount, parseList } from './lib/uibe.mjs';

const show = (tag, r) => console.log(`${tag.padEnd(42)} → 共 ${String(r.count).padStart(6)} 条 | ${r.rows.slice(0, 4).map((x) => x.title).join(' / ')}`);

for (const q of ['I247.56', 'I247.56 推理', 'I313.45', '侦探小说', '推理小说']) {
  await new Promise((r) => setTimeout(r, 900));
  try { show(`uibe q=${q}`, await search(q, { field: '' })); } catch (e) { console.log(`uibe q=${q} 失败 ${e.message}`); }
}

// ctbu：试 subjectSearch / 无 field
for (const f of ['', 'subjectSearch', 'titleSearch']) {
  await new Promise((r) => setTimeout(r, 900));
  try { show(`ctbu q=推理小说 field=${f || "(空)"}`, await search('推理小说', { field: f, site: 'ctbu' })); } catch (e) { console.log(`ctbu field=${f} 失败 ${e.message}`); }
}

// ctbu 的检索页表单里到底有哪些 field（直接抓一次检索页看 option）
await new Promise((r) => setTimeout(r, 900));
const html = await get(`${SITES.ctbu.base}${SITES.ctbu.path}?q=%E6%8E%A8%E7%90%86`);
const opts = [...html.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)].map((m) => `${m[1]}=${m[2].replace(/<[^>]+>/g, '').trim()}`);
console.log('ctbu 检索页 option：', opts.slice(0, 20).join(' | ') || '（无）');
const uibeHtml = await get(`${SITES.uibe.base}${SITES.uibe.path}?q=%E6%8E%A8%E7%90%86`);
const uopts = [...uibeHtml.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)].map((m) => `${m[1]}=${m[2].replace(/<[^>]+>/g, '').trim()}`);
console.log('uibe 检索页 option：', uopts.slice(0, 20).join(' | ') || '（无）');
console.log('ctbu 结果数：', resultCount(html), '行数：', parseList(html).length);
