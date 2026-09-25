/**
 * 一次性探针：第一个馆的检索表单里有没有「匹配方式」参数
 * ====================================================
 * §58.2 的结论是「`creatorSearch` 退化成单字 OR 匹配」。但**退化的原因可能是缺参数**：
 * 汇文系 OPAC 的表单通常还有「匹配方式」（前方一致／任意匹配／精确）这类选项，
 * 若它是以隐藏字段或下拉框提交的，而我上一轮只抄了 `field`，那检索就会一直用默认的宽松模式。
 *
 * 本探针把检索页上**所有** input / select 的 name 与取值打出来，并顺带试几种常见的
 * 匹配模式参数，看《犬神家一族》能否从「返回《李小龙》」变成「命中横沟正史」。
 */
import { SITES, get, parseList } from './lib/uibe.mjs';

const s = SITES.uibe;
const html = await get(`${s.base}${s.path}`);

console.log('=== 表单控件 ===');
const controls = html.match(/<(input|select|option)\b[^>]*>/gi) || [];
const seen = new Set();
for (const c of controls) {
  const name = /\bname=["']?([^"'\s>]+)/i.exec(c)?.[1] || '';
  const value = /\bvalue=["']?([^"'\s>]*)/i.exec(c)?.[1] || '';
  const type = /\btype=["']?([^"'\s>]+)/i.exec(c)?.[1] || c.match(/^<(\w+)/)[1];
  const key = `${type}|${name}|${value}`;
  if (seen.has(key)) continue;
  seen.add(key);
  if (!name && type !== 'select') continue;
  console.log(`  ${type.padEnd(8)} name=${name.padEnd(18)} value=${value}`);
}

console.log('\n=== 试参数：题名《犬神家一族》（期望作者＝横沟正史）===');
const VARIANTS = [
  ['基线', ''],
  ['matchType=exact', '&matchType=exact'],
  ['matchType=1', '&matchType=1'],
  ['searchType=exact', '&searchType=exact'],
  ['exact=true', '&exact=true'],
  ['matchWay=exact', '&matchWay=exact'],
  ['dup=exact', '&dup=exact'],
  ['sort=exact', '&sort=exact'],
  ['field=title&matchType=exact', '&matchType=exact'],
];
for (const [label, extra] of VARIANTS) {
  const qs = `q=${encodeURIComponent('犬神家一族')}&field=title${extra}`;
  try {
    const h = await get(`${s.base}${s.path}?${qs}`);
    const rows = parseList(h);
    const mine = rows.filter((r) => /横沟/.test(r.author || ''));
    console.log(
      `  ${label.padEnd(28)} 行 ${String(rows.length).padStart(2)}  横沟命中 ${mine.length}  首行：${
        rows[0] ? `${rows[0].title}／${rows[0].author}` : '（无）'
      }`,
    );
  } catch (e) {
    console.log(`  ${label.padEnd(28)} ✗ ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 800));
}
