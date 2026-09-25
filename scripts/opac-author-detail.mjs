/**
 * 按「作者枚举」的结果逐条取详情复核
 * ==================================
 * `opac-author-scan.mjs` 产出的 TSV 里只有**行内主题词**（分面截断后的展示），
 * 按纪律不能当最终判据。本脚本把候选逐条送进 `detail()` 取完整著录，
 * 打印著者 / 出版发行项 / 题名主题 / 中图分类 / 丛编项 / 原题名 / 提要，
 * 供人工判定「是不是推理小说、是不是已在库、是不是多作者合集」。
 *
 * 用法：node scripts/opac-author-detail.mjs --scan _dd/author-scan3.tsv --titles a,b,c
 */
import { readFileSync } from 'node:fs';
import { detail, subjectVerdict } from './lib/uibe.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const scan = arg('--scan', '_dd/author-scan.tsv');
const titles = (arg('--titles', '') || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
const delay = Number(arg('--delay', '700'));
const abstractLen = Number(arg('--abstract', '140'));

const rows = readFileSync(scan, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => l.split('\t'))
  .filter((c) => c[1] !== '__DONE__');

for (const w of titles) {
  const row = rows.find((c) => c[1] && c[1].includes(w));
  console.log(`\n### ${row ? row[1] : w}`);
  if (!row) {
    console.log('  （扫描结果里没有这一条）');
    continue;
  }
  try {
    const d = await detail(row[6]);
    const v = subjectVerdict(d.subjects);
    console.log(`  著者=${row[2]} | 出版=${d.imprint || row[4]} | 判据=${v.mystery ? '★是' : '否'}`);
    console.log(`  主题=${d.subjects || '-'}`);
    console.log(`  丛编=${d.series || '-'} | 原题=${d.titleNote || '-'} | 中图=${d.clc || '-'}`);
    console.log(`  提要=${(d.abstract || '-').slice(0, abstractLen)}`);
  } catch (e) {
    console.log(`  失败：${e.message}`);
  }
  await new Promise((r) => setTimeout(r, delay));
}
