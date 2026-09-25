/**
 * 跨馆复核：拿题名到第二个馆（重庆工商大学）查著录，看那边有没有
 * 「推理小说 / 侦探小说」主题词。
 *
 * **为什么要这一步**：对外经贸大学对 `I247.56` 的著录偏宽（盗墓、恐怖也常放这里），
 * 而「无主题词」那一桶又连主题词都没有，只剩分类号一条判据。
 * 到另一个馆查同一本书，如果那边的**学科主题词**明确写「推理小说」，
 * 就是一条**独立于第一个馆的第二份第①类证据**——比单看分类号硬得多。
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { search, detail } from './lib/uibe.mjs';

const inFile = process.argv[2] || '_dd/clc-nosubj.txt';
const outFile = process.argv[3] || '_dd/crosscheck.tsv';
const delay = Number(process.argv[4] || 900);

const done = new Set();
if (existsSync(outFile)) {
  for (const l of readFileSync(outFile, 'utf8').split(/\r?\n/)) {
    if (l.trim()) done.add(l.split('\t')[0]);
  }
}

const rows = readFileSync(inFile, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));

/** 只留中文字符做作者比对，避免「(英) 米涅·渥特丝著」这类前缀/后缀干扰 */
const authorKey = (s) => String(s || '').replace(/[^\u4e00-\u9fa5]/g, '');
/** 两串作者名是否指向同一人：取较短的一方做子串判据，并设最短长度门槛防误判 */
function authorMatch(a, b) {
  const x = authorKey(a);
  const y = authorKey(b);
  if (!x || !y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && long.includes(short);
}

let n = 0;
let falseHits = 0;
for (const r of rows) {
  const title = r[1];
  if (!title || done.has(title)) continue;
  let verdict = '未取到';
  let subjects = '';
  let series = '';
  let imprint = '';
  let abstract = '';
  try {
    // 先在 ctbu 按题名检索
    const res = await search(title, { site: 'ctbu' });
    const sameTitle = res.rows.filter(
      (x) => x.title.replace(/\s/g, '') === title.replace(/\s/g, '') || x.title.includes(title) || title.includes(x.title),
    );
    // ★ 关键约束：必须**作者也吻合**才算同一本书。
    // 只按题名比对会大量假命中——《世界》（南派三叔）在 ctbu 命中的是一本「品牌营销」书，
    // 《诅咒》（蔡骏）命中的是「环境经济」书，都是同名异书。
    const hit = sameTitle.find((x) => authorMatch(r[2], x.author));
    if (sameTitle.length && !hit) falseHits += 1;
    if (hit) {
      subjects = (hit.subjects || []).join(' ; ');
      imprint = hit.publisher || '';
      if (/推理小说|侦探小说/.test(subjects)) verdict = '双馆确认推理';
      else if (subjects) verdict = 'ctbu主题词非推理';
      else {
        // 行内没有主题词，取详情
        const d = await detail(hit.bookId, { site: 'ctbu' });
        subjects = d.subjects || '';
        series = d.series || '';
        imprint = d.imprint || imprint;
        abstract = (d.abstract || '').replace(/\s+/g, ' ');
        if (/推理小说|侦探小说/.test(subjects)) verdict = '双馆确认推理';
        else if (/推理小说|侦探小说|侦探|探案/.test(abstract)) verdict = '提要含推理字样';
        else if (subjects) verdict = 'ctbu主题词非推理';
        else verdict = 'ctbu亦无主题词';
      }
    } else if (sameTitle.length) {
      verdict = '同名异书（作者不符，不采信）';
    }
  } catch (e) {
    verdict = `查询失败：${e.message}`;
  }
  appendFileSync(outFile, [title, r[2], r[0], verdict, subjects, series, imprint, abstract.slice(0, 120)].join('\t') + '\n', 'utf8');
  n += 1;
  if (n % 20 === 0) console.log(`已复核 ${n} 条…（已挡下同名异书 ${falseHits} 条）`);
  await new Promise((res) => setTimeout(res, delay));
}
console.log(`完成，本次复核 ${n} 条，其中**同名异书被挡下 ${falseHits} 条** → ${outFile}`);
