// 一次性：把冈本绮堂「半七捕物帐」7 条误填的版本年从 firstPublished 迁到 editionYear
//
// 依据：这 7 条的年份（2010／2024）是**中译本的版本年**（当年是用当当补的版本年，
// 见 docs/collection-backlog.md 第十一节），而非「半七捕物帐」的原作年；作者卒于 1939，
// 年份晚于卒年即为判据。按选项 C 的字段语义，版本年应放 `editionYear`，
// 原作年目前取不到**就留空**——不拿系列起始年 1917 去凑（那会对每一卷都是臆测）。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const IDS = {
  'jpaudit64-004': '2024',
  'jpaudit64-005': '2010',
  'jpaudit65-005': '2010',
  'jpaudit73-001': '2010',
  'jpaudit73-002': '2010',
  'jpaudit73-003': '2010',
  'jpaudit76-002': '2010',
};

let n = 0;
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const p = `data/books/${f}`;
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  let dirty = false;
  for (const b of arr) {
    const y = IDS[b.id];
    if (!y) continue;
    const before = `firstPublished=${b.firstPublished || '(空)'} editionYear=${b.editionYear || '(空)'}`;
    b.editionYear = y;
    b.firstPublished = '';
    b.verification = b.verification || {};
    b.verification.source =
      (b.verification.source || '') +
      ` 【2026-09 年份语义修正】本条原先把 **${y}** 填在 \`firstPublished\` 里，但那是**中译本的版本年**（该值当年由当当补入，见 backlog 第十一节），不是「半七捕物帐」的原作年；作者卒于 1939，年份晚于卒年即为判据。按选项 C 的字段语义已改为 \`editionYear=${y}\`，\`firstPublished\` **留空**——**不拿系列起始年 1917 去凑**，那对具体每一卷都是臆测。`;
    dirty = true;
    n += 1;
    console.log(`✓ ${b.id}《${b.title}》 ${before} → firstPublished=(空) editionYear=${y}`);
  }
  if (dirty) writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf8');
}
console.log(`\n共修正 ${n} 条`);
