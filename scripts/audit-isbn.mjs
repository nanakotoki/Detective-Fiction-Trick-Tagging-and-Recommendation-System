#!/usr/bin/env node
/**
 * ISBN 校验闸门 `audit-isbn`
 * ========================
 * **为什么需要它**：第 83 轮我在写 spec 时给两条书**顺手「推」了 ISBN**
 * （按同社其他书的号段编的），落库后才逐条核出来。这类错有两个特点：
 *   ① `check-data.mjs` 不查（ISBN 不是数据字段，只出现在 `verification.source` 的证据串里）；
 *   ② 一旦写进证据串，**看起来就跟真的一样**，日后没人会再逐条核对。
 *
 * 而 ISBN 自带校验位——**编造的号段几乎必然算不过校验**。本脚本：
 *   1. 从每个条目的 `verification.source`（以及 `editionYearSource` 等）里抽出所有 ISBN；
 *   2. 按 ISBN-13／ISBN-10 规则算校验位，**算不过的报错**；
 *   3. 顺带报告「同一条目里出现多个 ISBN」「库里两个条目引用同一 ISBN」这类可疑情形。
 *
 * 用法：
 *   node scripts/audit-isbn.mjs            # 报告，不修改任何数据
 *   node scripts/audit-isbn.mjs --strict   # 有校验失败时以非零码退出（可挂进 CI）
 */
import { readFileSync, readdirSync } from 'node:fs';

const STRICT = process.argv.includes('--strict');

/** 归一成纯数字（去掉连字符与空格；把 X 统一成大写） */
const digits = (s) => s.replace(/[^0-9Xx]/g, '').toUpperCase();

/** ISBN-13 校验位 */
function isbn13Ok(d) {
  if (d.length !== 13 || !/^\d{13}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(d[12]);
}
/** ISBN-10 校验位（含 X=10） */
function isbn10Ok(d) {
  if (d.length !== 10 || !/^\d{9}[\dX]$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) sum += (d[i] === 'X' ? 10 : Number(d[i])) * (10 - i);
  return sum % 11 === 0;
}

const FILES = readdirSync('data/books').filter((x) => x.endsWith('.json') && !x.startsWith('_'));
const bad = [];
const perBook = [];
const byIsbn = new Map();

for (const f of FILES) {
  for (const b of JSON.parse(readFileSync(`data/books/${f}`, 'utf8'))) {
    const texts = [b.verification?.source, b.verification?.editionYearSource].filter(Boolean).join(' ｜ ');
    /**
     * **抽取规则要收紧**。第一版用了一条宽泛的「八九位以上数字串」，结果把
     * 「扬州市图书馆 OPAC marc 0000964465」里的**馆藏控制号**也当成 ISBN，
     * 一口气报出 138 个「校验位错误」——全是假阳性。现在只认三种写法：
     *   ① `ISBN` 字样后面跟的号；② `978/979` 开头的 13 位；③ 带连字符的 10 位（如 `7-5014-1848-9`）。
     * 并且**排除紧跟在 marc／OPAC／馆藏 之后的数字**。
     */
    const cands = [];
    /**
     * **先吃掉 13 位号，再从剩下的文字里找 10 位号。**
     *
     * 第二版又踩了一次假阳性：`978-7-221-14679-3` 会被「带连字符的 10 位」那条规则
     * 从 `7-` 处截出一个 `7-221-14679-3`，当成 ISBN-10 去算校验位，必然算不过——
     * 于是 200 多条本来正确的条目被报成错。**同一个坑一天踩两次，值得写进注释。**
     */
    const masked = texts.replace(/\b97[89][-\s]?(?:\d[-\s]?){9}\d\b/g, (m) => {
      cands.push(m);
      return ' '.repeat(m.length);
    });
    for (const m of masked.matchAll(/ISBN[^\dXx]{0,6}([0-9Xx][0-9Xx\-\s]{8,20})/g)) cands.push(m[1]);
    for (const m of masked.matchAll(/\b\d{1,5}-\d{1,7}-\d{1,7}-[\dXx]\b/g)) cands.push(m[0]);
    const found = [];
    const documented = [];
    for (const c of cands) {
      const d = digits(c);
      if (d.length !== 10 && d.length !== 13) continue;
      // 排除馆藏控制号：取该串在原文中的位置，看前面 12 个字里有没有 marc/OPAC/馆藏
      const at = texts.indexOf(c.trim());
      if (at > 0 && /marc|OPAC|馆藏/i.test(texts.slice(Math.max(0, at - 12), at))) continue;
      /**
       * **已标注为错误的号不算失败**。第 84 轮更正两条证据串时，
       * 更正说明本身会**引用**那个错号（「原引 ISBN `978-7-80225-887-8` 校验位不成立…」），
       * 闸门于是把同一个号又抓了一遍。这里区分两类：
       *   · `documented`：上下文里有「更正／误植／不成立／已删除」字样 → 只登记，不计失败；
       *   · 其余 → 视为**新引入的错号**，计失败。
       */
      const near = at > 0 ? texts.slice(Math.max(0, at - 60), at + 60) : '';
      if (/更正|误植|不成立|已删除|系误/.test(near)) documented.push(d);
      else found.push(d);
    }
    for (const d of documented) {
      if (!byIsbn.has(d)) byIsbn.set(d, []);
      byIsbn.get(d).push(`${f}#${b.id}`);
    }
    if (!found.length) continue;
    perBook.push({ f, id: b.id, title: b.title, isbns: [...new Set(found)] });
    for (const d of new Set(found)) {
      if (!byIsbn.has(d)) byIsbn.set(d, []);
      byIsbn.get(d).push(`${f}#${b.id}`);
      const ok = d.length === 13 ? isbn13Ok(d) : isbn10Ok(d);
      if (!ok) bad.push({ f, id: b.id, title: b.title, isbn: d, kind: d.length === 13 ? 'ISBN-13' : 'ISBN-10' });
    }
  }
}

console.log('\n  ISBN 校验闸门');
console.log('  ────────────────────────────────────────────');
console.log(`  条目总数 ${FILES.reduce((s, f) => s + JSON.parse(readFileSync(`data/books/${f}`, 'utf8')).length, 0)}`);
console.log(`  证据串里带 ISBN 的条目：${perBook.length}，ISBN 去重后 ${byIsbn.size} 个\n`);

if (bad.length) {
  console.log(`  ✗ 校验位算不过的 ISBN：${bad.length} 个`);
  for (const x of bad) console.log(`      ${x.isbn}（${x.kind}）← 《${x.title}》 ${x.f}#${x.id}`);
} else {
  console.log('  ✓ 所有 ISBN 的校验位都算得过');
}

/** 同一条目里出现多个 ISBN：可能是证据串同时引了丛书的其他册 */
const multi = perBook.filter((x) => x.isbns.length > 1);
if (multi.length) {
  console.log(`\n  ! 同一条目引用了多个 ISBN：${multi.length} 条（多为合订本或丛书说明，需人工看一眼）`);
  for (const x of multi.slice(0, 12)) console.log(`      《${x.title}》 → ${x.isbns.join('、')}`);
  if (multi.length > 12) console.log(`      ……另有 ${multi.length - 12} 条`);
}

/** 同一个 ISBN 落在多个条目上：**可能是同书异名的信号** */
const shared = [...byIsbn.entries()].filter(([, v]) => v.length > 1);
if (shared.length) {
  console.log(`\n  ! 同一个 ISBN 出现在多个条目上：${shared.length} 个（★ 优先看这些——可能是同书异名或套装共用号）`);
  for (const [d, v] of shared) console.log(`      ${d} → ${v.join(' ／ ')}`);
}

console.log('');
if (STRICT && bad.length) process.exit(1);
