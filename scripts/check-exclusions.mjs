#!/usr/bin/env node
/**
 * 排除项回归检查 `check-exclusions`
 * =================================
 * **为什么需要它**：用户口径是「**纯恐怖、纯间谍不收**，泛推理收」，而这条边界
 * 靠**人记**是记不住的——本次复核就发现库里躺着 8 条越界条目：
 *
 *   · 勒卡雷《锅匠，裁缝，士兵，间谍》《史迈利的人马》——台账里**早就写过**
 *     「公认的纯间谍小说，按用户口径从严排除」，结果后来从别的馆藏批次又收了进来；
 *   · 麦家《风声》《解密》《暗算》——台账把「麦家系列」列为「两馆确实没有的书」，
 *     同样在别的批次被收了进来；
 *   · 《沙岸之谜》（入侵惊险小说鼻祖）、《第十三种人格的恐怖》（主题词「恐怖小说」）、
 *     《夏天·烟火·我的尸体》（三条著录都只有「长篇小说」，无推理判据）。
 *
 * 根因不是判据不清，而是**判据只写在台账的自然语言里，机器读不到**。
 * 所以把结论落成 `data/exclusions.json`，再用本脚本当闸门：
 * 每次批量入库后跑一遍，**排除项一旦回流就报错**，把「口径漂移」变成一次构建失败。
 *
 * 同时提醒流派标签：受控词表里有「间谍小说」「恐怖」，若库里出现这两种流派，
 * 说明又有越界条目进来（除非它同时被标为推理向，否则应当剔除）。
 *
 * 用法：
 *   node scripts/check-exclusions.mjs            # 有回流即非零退出
 *   node scripts/check-exclusions.mjs --quiet    # 只在出错时输出
 */
import { readFileSync } from 'node:fs';
import { loadSeedBooks } from '../web/js/core/seed.js';

const quiet = process.argv.includes('--quiet');
const exclusions = JSON.parse(readFileSync('data/exclusions.json', 'utf8'));
const books = loadSeedBooks();

const problems = [];

/**
 * 先查排除表**自身**的完整性。
 * 少了这一步，一份被清空或写坏的 `exclusions.json` 会让下面的循环一次都不执行，
 * 闸门照样输出「通过」——这正是本项目最忌讳的**静默失效**。
 */
if (!Array.isArray(exclusions.titles) || exclusions.titles.length === 0) {
  console.error('✗ data/exclusions.json 的 titles 为空或不是数组：排除表失效会让本闸门形同虚设。');
  process.exit(1);
}
if (!/纯恐怖|恐怖/.test(exclusions.rule || '') || !/间谍/.test(exclusions.rule || '')) {
  console.error('✗ data/exclusions.json 的 rule 丢失了「纯恐怖、纯间谍不收」的口径原文。');
  process.exit(1);
}
for (const e of exclusions.titles) {
  if (!e.title) problems.push('排除表里有一条缺 title');
  if (!e.reason || e.reason.length < 8) problems.push(`《${e.title}》缺排除理由（reason 至少 8 字）`);
}

for (const e of exclusions.titles || []) {
  const hit = books.find((b) => b.title === e.title);
  if (hit) {
    problems.push(
      `《${e.title}》${e.author ? `（${e.author}）` : ''} 回流入库 —— 排除理由：${e.reason}`,
    );
  }
}

const scopeLabels = books.filter((b) => /间谍小说|恐怖/.test(b.genre || ''));
for (const b of scopeLabels) {
  problems.push(`《${b.title}》（${b.author}）流派标为「${b.genre}」——属用户口径排除范围，须剔除或改归推理向流派`);
}

if (problems.length) {
  console.error(`\n✗ 排除项检查未通过，共 ${problems.length} 处：\n`);
  for (const p of problems) console.error(`  · ${p}`);
  console.error('\n  处理办法见 data/exclusions.json 的 rule 与 docs/collection-backlog.md 对应小节。\n');
  process.exit(1);
}

if (!quiet) {
  console.log(
    `✓ 排除项检查通过：${(exclusions.titles || []).length} 条排除登记均未回流，` +
      `全库 ${books.length} 部无一标注为间谍小说／恐怖。`,
  );
}
